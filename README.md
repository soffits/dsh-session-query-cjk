# dsh-session-query-cjk

A session search extension for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) capable of locating Chinese, Japanese, and Korean terms within sentences.

Messages are indexed by DSH's built-in `@deepseek-ai/dsh-session-query-sqlite` through the `unicode61` tokenizer of SQLite FTS5. With that tokenizer, an entire uninterrupted sequence of Han or kana becomes a single token; as a result, `鸡蛋` can never match `今天去超市买了鸡蛋和牛奶`, and only a run bounded exactly by punctuation will. An English word attached to Chinese behaves the same way, such as `Python` in `用Python写脚本`. This behavior is covered in discussions [#1999](https://github.com/deepseek-ai/deepseek-harness/discussions/1999) and [#9064](https://github.com/deepseek-ai/deepseek-harness/discussions/9064).

One modification distinguishes this package from the upstream provider: a reserved separator is inserted around each CJK code point before text enters the index and before a query reaches `MATCH`, making every such code point a separate token. Queries already arrive as a single quoted phrase, and an FTS5 phrase requires its tokens to be adjacent and in order; consequently, any CJK substring can now match—whether one character, two (`房租`), or an entire sentence. `蛋鸡` continues not to match `鸡蛋`. The separator is removed again from snippets, leaving the original text visible in results.

For text containing no CJK characters, tokenization is identical to before, and the test suite from upstream at the same version still passes without modification. English-language results are additionally compared directly with the upstream package by the tests included here.

## Install

It takes the same configuration as the `session-query-sqlite` row (`path`, `openAt`, limits) and provides the same `sessionQuery` service. Install it into your profile (for example `dsh plugin --profile web add <tarball URL>`), then, in the profile's `cordis.patch.yml`, switch the stock row off and add this one in its place. A patch can't rename an existing row, so it gets a new id:

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

Use the same `config` you had on the stock row, so the same index file is reused. Release tarballs are on the [releases page](https://github.com/soffits/dsh-session-query-cjk/releases). Restart DSH afterwards.

Keeping an existing index file is acceptable: its schema version is not the same as upstream's, so the first time it is opened, the derived tables are discarded and reconstructed from the session logs—the identical reset procedure upstream applies when its own schema changes. Returning to the upstream package causes a rebuild in the opposite direction. Session logs are accessed in read-only fashion.

## Limits

- Since matching works by substring, a CJK query can also cross punctuation (`鸡蛋` matches `鸡，蛋`), just as `alpha beta` matches `alpha, beta` in the upstream package.
- No support exists for Thai, Lao, Khmer, or Burmese; those languages require a dictionary-based segmenter.
- Every version is based on a single upstream release and requires the corresponding DSH version: the first release built on `0.2.2-rc.1` is `0.2.2-rc.1.1`.

## Development

```sh
npm install
npm test
```

## License

MIT. Derived from `@deepseek-ai/dsh-session-query-sqlite` (MIT, Copyright (c) 2026 DeepSeek); refer to LICENSE.
