# dsh-session-query-cjk

Session search in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that finds words in Chinese, Japanese, and Korean inside a sentence.

DSH's built-in search, `@deepseek-ai/dsh-session-query-sqlite`, indexes messages with the `unicode61` tokenizer from SQLite FTS5. For that tokenizer, any unbroken run of kana or Han characters is one token. That means `鸡蛋` never matches `今天去超市买了鸡蛋和牛奶`; you get a hit only when punctuation happens to break the run at precisely the right place. An English word glued to Chinese hits the same wall, as `Python` does in `用Python写脚本`. It has come up in discussions [#1999](https://github.com/deepseek-ai/deepseek-harness/discussions/1999) and [#9064](https://github.com/deepseek-ai/deepseek-harness/discussions/9064).

This package changes one thing. Before text goes into the index and before a query reaches `MATCH`, it puts a reserved separator around each CJK character, which makes every character a token of its own. A query arrives as one quoted phrase; FTS5 requires the tokens in a phrase to sit next to each other in order, so any CJK substring now matches: a single character, two characters (`房租`), or an entire sentence. `蛋鸡` still won't match `鸡蛋`. The separator is stripped from snippets again, so results display the original text.

Text with no CJK is tokenized exactly as it was before. The upstream test suite for that version passes unchanged, and this package's tests compare English results directly with the upstream package too.

## Install

It takes the same config as the `session-query-sqlite` row (`path`, `openAt`, limits) and provides the exact same `sessionQuery` service. Add it to your profile (for instance, `dsh plugin --profile web add <tarball URL>`), then disable the stock row for that profile in its `cordis.patch.yml` and put this row where it was. A patch can't rename an existing row, so this row must have an id of its own:

```yaml
- id: session-query-sqlite
  disabled: true
- insert:
    - id: session-query-cjk
      name: '@soffits/dsh-session-query-cjk'
      config:
        path: /absolute/path/to/session-search/index.sqlite
        openAt: first-search
```

Carry the `config` over from that stock row so it uses the same index file. Release tarballs are on the [releases page](https://github.com/soffits/dsh-session-query-cjk/releases). Then restart DSH.

You can keep your current index file. It has a different schema version from upstream, so the first time it opens, it drops the derived tables and rebuilds them from the session logs. Upstream does that same reset whenever its schema changes. If you go back to the upstream package, the tables get rebuilt the other way. The session logs stay read-only.

## Limits

- Substring matching means a CJK query can also match across punctuation (`鸡蛋` matches `鸡，蛋`), just as upstream lets `alpha beta` match `alpha, beta`.
- This package doesn't handle Thai, Lao, Khmer, or Burmese; those languages need a dictionary-based segmenter.
- Each version targets one upstream release and needs the DSH version that matches it: for `0.2.2-rc.1`, the first release is `0.2.2-rc.1.1`.

## Development

```sh
npm install
npm test
```

## License

MIT. Derived from `@deepseek-ai/dsh-session-query-sqlite` (MIT, Copyright (c) 2026 DeepSeek); see LICENSE.
