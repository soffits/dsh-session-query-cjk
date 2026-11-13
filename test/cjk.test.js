import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Context } from "@deepseek-ai/cordis";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import SessionStore, { SESSION_FORMAT_VERSION, SessionSeq } from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import * as JsonlSessionPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import UpstreamEngine from "@deepseek-ai/dsh-session-query-sqlite";
import CjkEngine, { SESSION_QUERY_SQLITE_APPLICATION_ID, SESSION_QUERY_SQLITE_SCHEMA_VERSION } from "../lib/index.js";

const directories = [];
afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function temporaryPath(name) {
	const directory = await mkdtemp(join(tmpdir(), "dsh-session-query-cjk-"));
	directories.push(directory);
	return join(directory, name);
}

function messageEvents(text, time = 1) {
	return [{
		type: "user/message",
		seq: SessionSeq(0),
		time,
		data: createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }),
		surfaceOp: "append"
	}];
}

function header(id, createdAt = 1) {
	return { version: SESSION_FORMAT_VERSION, id, createdAt, isSeeded: false };
}

async function liveContext(Engine, texts, config = { path: ":memory:" }) {
	const ctx = new Context();
	await ctx.plugin(SessionStore);
	await ctx.plugin(SessionProjectionRegistry);
	await ctx.plugin(Engine, config);
	for (const [id, text] of Object.entries(texts)) ctx.sessions.create(id, { seed: messageEvents(text, 10), meta: { createdAt: 1 } });
	return ctx;
}

async function hitIds(ctx, query) {
	const result = await ctx.sessionQuery.searchSessions({ query });
	return result.items.map((item) => item.header.id).sort();
}

const CJK_CORPUS = {
	groceries: "今天去超市买了鸡蛋和牛奶，房租下周三交。",
	code: "我想用Python写一个脚本来整理账单",
	reversed: "这里只有蛋鸡两个字",
	japanese: "朝はコーヒーを飲みたいです",
	korean: "내일 서울에서 만나요",
	rare: "生僻字𠀀𠀁也要能搜到",
	english: "plain english testing words only"
};

describe("CJK substrings", () => {
	it("finds two-character words inside a Chinese sentence", async () => {
		const ctx = await liveContext(CjkEngine, CJK_CORPUS);
		assert.deepEqual(await hitIds(ctx, "鸡蛋"), ["groceries"]);
		assert.deepEqual(await hitIds(ctx, "房租"), ["groceries"]);
		assert.deepEqual(await hitIds(ctx, "账单"), ["code"]);
	});

	it("finds three-character and longer words, single characters and the whole sentence", async () => {
		const ctx = await liveContext(CjkEngine, CJK_CORPUS);
		assert.deepEqual(await hitIds(ctx, "买了鸡蛋"), ["groceries"]);
		assert.deepEqual(await hitIds(ctx, "下周三"), ["groceries"]);
		assert.deepEqual(await hitIds(ctx, "超"), ["groceries"]);
		assert.deepEqual(await hitIds(ctx, "今天去超市买了鸡蛋和牛奶"), ["groceries"]);
	});

	it("keeps character order: 鸡蛋 and 蛋鸡 are different words", async () => {
		const ctx = await liveContext(CjkEngine, CJK_CORPUS);
		assert.deepEqual(await hitIds(ctx, "蛋鸡"), ["reversed"]);
		assert.deepEqual(await hitIds(ctx, "鸡奶"), []);
	});

	it("finds English words glued to Chinese text, and mixed queries", async () => {
		const ctx = await liveContext(CjkEngine, CJK_CORPUS);
		assert.deepEqual(await hitIds(ctx, "Python"), ["code"]);
		assert.deepEqual(await hitIds(ctx, "python"), ["code"]);
		assert.deepEqual(await hitIds(ctx, "用Python写"), ["code"]);
		assert.deepEqual(await hitIds(ctx, "Python 写"), ["code"]);
	});

	it("finds Japanese, Korean and supplementary-plane Han substrings", async () => {
		const ctx = await liveContext(CjkEngine, CJK_CORPUS);
		assert.deepEqual(await hitIds(ctx, "コーヒー"), ["japanese"]);
		assert.deepEqual(await hitIds(ctx, "飲み"), ["japanese"]);
		assert.deepEqual(await hitIds(ctx, "서울"), ["korean"]);
		assert.deepEqual(await hitIds(ctx, "𠀁"), ["rare"]);
		assert.deepEqual(await hitIds(ctx, "𠀀𠀁"), ["rare"]);
	});

	it("returns the original text in snippets and events", async () => {
		const ctx = await liveContext(CjkEngine, CJK_CORPUS, { path: ":memory:", snippetChars: 12 });
		const events = await ctx.sessionQuery.searchEvents({ sessionId: "groceries", query: "房租" });
		assert.equal(events.items.length, 1);
		const snippet = events.items[0].snippet;
		assert.ok(snippet.includes("房租"), snippet);
		assert.ok(!snippet.includes("﷒"), "separator leaked into the snippet");
		assert.equal(Array.from(snippet).length <= 12, true);
		const full = await liveContext(CjkEngine, CJK_CORPUS, { path: ":memory:", snippetChars: 240 });
		const whole = await full.sessionQuery.searchEvents({ sessionId: "code", query: "Python" });
		assert.equal(whole.items[0].snippet, CJK_CORPUS.code);
	});

	it("maps a stray separator code point in text to U+FFFD, like the highlight markers", async () => {
		const ctx = await liveContext(CjkEngine, { odd: "a﷒b 中﷒文" });
		const result = await ctx.sessionQuery.searchSessions({ query: "中" });
		assert.equal(result.items[0].bestMatch.snippet, "a�b 中�文");
		assert.deepEqual(await hitIds(ctx, "b"), ["odd"]);
	});

	it("indexes persisted sessions the same way", async () => {
		const root = await temporaryPath("sessions");
		const path = await temporaryPath("search.db");
		const ctx = new Context();
		await ctx.plugin(SessionStore);
		await ctx.plugin(SessionProjectionRegistry);
		const persistence = await ctx.plugin(JsonlSessionPersistence, { root, compression: "none" });
		const search = await ctx.plugin(CjkEngine, { path });
		const meta = header("persisted", 10);
		const writer = await ctx.sessionPersistence.create(meta);
		await writer.append(messageEvents("记得交房租和买鸡蛋"));
		await writer.close();
		const result = await ctx.sessionQuery.searchSessions({ query: "房租" });
		assert.equal(result.items.length, 1);
		assert.equal(result.items[0].persisted, true);
		assert.equal(result.items[0].live, false);
		assert.equal(result.items[0].bestMatch.snippet, "记得交房租和买鸡蛋");
		await search.dispose();
		await persistence.dispose();
	});
});

describe("unchanged behaviour outside CJK", () => {
	const ENGLISH_CORPUS = {
		a: "😀😀 alpha beta BRAID 😀😀",
		b: "alpha beta",
		c: "alpha middle beta",
		d: "Ünïcödé café naïve résumé",
		e: "needle OR absent",
		f: "say \"needle\" exactly",
		g: "An AI helper, testing tokenizers; e-mail foo_bar 3.14",
		h: "Привет мир and Ελληνικά"
	};
	const QUERIES = ["alpha beta", "alpha", "beta", "BRAID", "braid", "AI", "cafe", "café", "resume", "needle OR absent", "say \"needle\"", "*", "test", "testing", "e-mail", "foo_bar", "3.14", "мир", "ελληνικα", "middle", "😀"];

	it("returns exactly what upstream returns for non-CJK text", async () => {
		const upstream = await liveContext(UpstreamEngine, ENGLISH_CORPUS);
		const cjk = await liveContext(CjkEngine, ENGLISH_CORPUS);
		for (const query of QUERIES) {
			const expected = await upstream.sessionQuery.searchSessions({ query });
			const actual = await cjk.sessionQuery.searchSessions({ query });
			const strip = (page) => page.items.map((item) => ({ id: item.header.id, bestMatch: item.bestMatch }));
			assert.deepEqual(strip(actual), strip(expected), `query ${JSON.stringify(query)}`);
		}
	});
});

describe("on-disk index migration", () => {
	it("rebuilds an upstream index in place, and upstream rebuilds it back", async () => {
		const path = await temporaryPath("index.sqlite");
		const texts = { s: "今天去超市买了鸡蛋 plus english words" };

		const before = await liveContext(UpstreamEngine, texts, { path });
		assert.deepEqual(await hitIds(before, "鸡蛋"), []);
		assert.deepEqual(await hitIds(before, "english"), ["s"]);
		await before.sessionQuery.close();
		assert.equal(readVersion(path), 8);

		const after = await liveContext(CjkEngine, texts, { path });
		assert.deepEqual(await hitIds(after, "鸡蛋"), ["s"]);
		assert.deepEqual(await hitIds(after, "english"), ["s"]);
		await after.sessionQuery.close();
		assert.equal(readVersion(path), SESSION_QUERY_SQLITE_SCHEMA_VERSION);

		const back = await liveContext(UpstreamEngine, texts, { path });
		assert.deepEqual(await hitIds(back, "english"), ["s"]);
		await back.sessionQuery.close();
		assert.equal(readVersion(path), 8);
	});

	it("still refuses databases that belong to something else", async () => {
		const path = await temporaryPath("other.sqlite");
		const db = new DatabaseSync(path);
		db.exec("CREATE TABLE notes (body TEXT)");
		db.close();
		const ctx = await liveContext(CjkEngine, {}, { path, openAt: "first-search" });
		await assert.rejects(ctx.sessionQuery.searchSessions({ query: "x" }), (error) => error.code === "SESSION_QUERY_INDEX_FAILED");
		const check = new DatabaseSync(path);
		assert.deepEqual(check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name), ["notes"]);
		check.close();
	});
});

function readVersion(path) {
	const db = new DatabaseSync(path);
	try {
		assert.equal(db.prepare("PRAGMA application_id").get().application_id, SESSION_QUERY_SQLITE_APPLICATION_ID);
		return db.prepare("PRAGMA user_version").get().user_version;
	} finally {
		db.close();
	}
}
