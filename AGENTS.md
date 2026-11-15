# Maintainer notes

## What this is

A fork of `@deepseek-ai/dsh-session-query-sqlite` (the built `lib/index.js` of the npm package, not the TypeScript source) with CJK segmentation added. The first commit is the upstream package copied unchanged; everything after it is ours, so `git diff <first commit> -- lib/index.js` is the whole patch.

The patch, all in `lib/index.js`:

- `segmentCjk()` puts `CJK_SEPARATOR` (U+FDD2) at every boundary next to a Han, kana, Hangul or Bopomofo code point (plus ー U+30FC, ｰ U+FF70).
- Both FTS5 tables use `tokenize = 'unicode61 separators ''﷒'''` (unicode61 treats noncharacters as token characters unless declared).
- `_replacePersistedSession` / `_replaceLiveSession` insert `segmentCjk(text)`; `codepoint_length` stays the length of the original text, so ranking is unchanged.
- `selectedDocumentsParams` quotes `segmentCjk(query)`.
- `normalizeMarkedText` drops the separator, so snippets show the original text; `sanitizeFtsText` maps any stray U+FDD2 in source text to U+FFFD, like the highlight markers.
- `SESSION_QUERY_SQLITE_SCHEMA_VERSION` is `1008001` (upstream schema 8, our revision 1) and the two hardcoded `8`s use the constant. The number is far from upstream's sequence on purpose: switching between this package and upstream on the same file always triggers the reset path, never a silent reuse of the other's index.

## Decisions

- **Unigram tokens + phrase query, not bigrams, trigram, or a segmenter extension.** The query was already one quoted FTS5 phrase, so one token per CJK code point gives exact substring matching for any length, including single characters and two-character words. Bigrams (Lucene CJK style) miss one-character queries; SQLite's `trigram` tokenizer can't answer queries under three characters without a full-scan `LIKE` fallback and also changes English to substring matching; jieba/ICU/`simple` need a native extension per platform and miss substrings across their own word boundaries. Cost on a real 519-session corpus: index +5% (221 vs 211 MB), full rebuild 35 s vs 31 s.
- **Known false positive:** a CJK phrase matches across punctuation (`鸡蛋` in `鸡，蛋`), the same phrase semantics upstream has for `alpha beta` vs `alpha, beta`.
- **Same application id as upstream**, so the package is a drop-in on an existing index file.

## Porting to a new upstream release

1. `npm pack @deepseek-ai/dsh-session-query-sqlite@<version>` and diff its `lib/index.js` with the first commit's copy. If unchanged apart from the version, only bump `package.json` (peers, devDependencies, `version` = `<upstream>.1`).
2. Otherwise commit the new upstream files unchanged first, then re-apply the patch above (if upstream changed its schema version, use `1000000 + <upstream schema> * 1000 + 1`).
3. `npm test` and `npm run test:upstream` (upstream's `tests/sqlite.spec.ts` for that tag, run with vitest against this `lib/index.js`); both must pass in full.
4. Bump `engines.dsh`.

## Git

- PR titles are Conventional Commit subjects (`feat: ...`, `fix(scope): ...`), because a squash merge makes the title the commit on the default branch; CI checks it.
