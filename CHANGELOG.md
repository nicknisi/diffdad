# Changelog

## [0.17.0](https://github.com/nicknisi/diffdad/compare/v0.16.0...v0.17.0) (2026-08-28)


### Features

* **narrative:** sequence diagram section type with guided tour ([#78](https://github.com/nicknisi/diffdad/issues/78)) ([71a7013](https://github.com/nicknisi/diffdad/commit/71a70139a366e55bb6ce9d9636702b542be5f6d9))
* **server:** real thread resolution via the GraphQL reviewThreads API ([#76](https://github.com/nicknisi/diffdad/issues/76)) ([cca85d0](https://github.com/nicknisi/diffdad/commit/cca85d0810a214cc09583380e97b5c176728d01e))
* verified trace quotes, staleness banner, and re-narrate ([#77](https://github.com/nicknisi/diffdad/issues/77)) ([897688f](https://github.com/nicknisi/diffdad/commit/897688fc9b86ce42a0fb57abf4fd2e3056585c9b))

## [0.16.0](https://github.com/nicknisi/diffdad/compare/v0.15.2...v0.16.0) (2026-08-28)


### Features

* **cache:** sealed narrative revisions with last-good fallback ([#65](https://github.com/nicknisi/diffdad/issues/65)) ([b43719c](https://github.com/nicknisi/diffdad/commit/b43719ce7caa4cc5716526e8ce105bac8c17356c))
* **contracts:** shared wire-contract package, adopted on both sides ([#69](https://github.com/nicknisi/diffdad/issues/69)) ([85e2dd5](https://github.com/nicknisi/diffdad/commit/85e2dd55bea16ada02443d94c1c969da35b675c4))
* **narrative:** callstack section type for call-flow changes ([#73](https://github.com/nicknisi/diffdad/issues/73)) ([ad75257](https://github.com/nicknisi/diffdad/commit/ad752572b29ca152887ff9b9e9f10f0133d0475f))
* **narrative:** content-derived anchors that re-resolve stale hunk refs ([#70](https://github.com/nicknisi/diffdad/issues/70)) ([93f8209](https://github.com/nicknisi/diffdad/commit/93f820988bd1151d839d91f19e520a5e2f1d5817))
* **narrative:** enforce anchor validation with retry and repair ([#64](https://github.com/nicknisi/diffdad/issues/64)) ([1d89cdc](https://github.com/nicknisi/diffdad/commit/1d89cdc3556c2ed5dbc553234684642007faf177))
* **recap:** surface the prompts that drove an agent-authored PR ([#72](https://github.com/nicknisi/diffdad/issues/72)) ([90be9c8](https://github.com/nicknisi/diffdad/commit/90be9c8ac915218a76471a465d48329790f9c3d1))
* **server:** derive review-round status from GitHub state ([#71](https://github.com/nicknisi/diffdad/issues/71)) ([1a0c85f](https://github.com/nicknisi/diffdad/commit/1a0c85f19938db48184b0a665b73a2d98f18748e))
* **web:** find-in-review widget ([#68](https://github.com/nicknisi/diffdad/issues/68)) ([5f3e041](https://github.com/nicknisi/diffdad/commit/5f3e041280c2a4d5b776e7667aed946a2647d80f))
* **web:** rail-to-pill chapter TOC with scroll-spy ([#67](https://github.com/nicknisi/diffdad/issues/67)) ([cca7420](https://github.com/nicknisi/diffdad/commit/cca7420018fdc9f9485c597889f851218434cf98))


### Bug Fixes

* **release:** update Homebrew for Linux ARM64 ([#62](https://github.com/nicknisi/diffdad/issues/62)) ([32b68f8](https://github.com/nicknisi/diffdad/commit/32b68f817f6d21925fbef290ac1967869fab1b8a))
* **server:** snapshot regen state, back off failed regens, bind loopback ([#74](https://github.com/nicknisi/diffdad/issues/74)) ([9278603](https://github.com/nicknisi/diffdad/commit/9278603c74153ee405c0a5824177a1661d310cf1))
* **web:** harden markdown rendering against HTML and URL injection ([#66](https://github.com/nicknisi/diffdad/issues/66)) ([0252bc2](https://github.com/nicknisi/diffdad/commit/0252bc20d9d7c2a920a043dd73cdaba9b0caba81))

## [0.15.2](https://github.com/nicknisi/diffdad/compare/v0.15.1...v0.15.2) (2026-08-21)


### Bug Fixes

* **release:** publish Linux ARM64 binaries ([#60](https://github.com/nicknisi/diffdad/issues/60)) ([365b394](https://github.com/nicknisi/diffdad/commit/365b3943f0271377aa7a74d9189e7ee749c98fc2))

## [0.15.1](https://github.com/nicknisi/diffdad/compare/v0.15.0...v0.15.1) (2026-08-12)


### Bug Fixes

* **cli:** make Bedrock Claude Opus 5 generation work (reasoning stream crash + thinking token burn) ([#54](https://github.com/nicknisi/diffdad/issues/54)) ([0b68c64](https://github.com/nicknisi/diffdad/commit/0b68c64323097e1b6b14da7a49e97543227f0447))

## [0.15.0](https://github.com/nicknisi/diffdad/compare/v0.14.0...v0.15.0) (2026-08-01)


### Features

* attention lanes — sort the queue by what actually needs a human ([#57](https://github.com/nicknisi/diffdad/issues/57)) ([f785ca1](https://github.com/nicknisi/diffdad/commit/f785ca1bff8f5c86f24516aa3a4b0672abcfa649))
* collapse what a reviewer can skip, backed by repo-wide blast radius ([#55](https://github.com/nicknisi/diffdad/issues/55)) ([35a7733](https://github.com/nicknisi/diffdad/commit/35a77333ba8a943319aa9812eaa11b272532b2e0))

## [0.14.0](https://github.com/nicknisi/diffdad/compare/v0.13.0...v0.14.0) (2026-07-25)


### Features

* add Amazon Bedrock as an AI provider ([#49](https://github.com/nicknisi/diffdad/issues/49)) ([4c98b9c](https://github.com/nicknisi/diffdad/commit/4c98b9c0baa601ce13a6fa31e6abfac809260cac))

## [0.13.0](https://github.com/nicknisi/diffdad/compare/v0.12.1...v0.13.0) (2026-07-18)


### Features

* daemon review parity, resolve-strip comments, concise stories ([#51](https://github.com/nicknisi/diffdad/issues/51)) ([1ca92ee](https://github.com/nicknisi/diffdad/commit/1ca92eeb8070b56fda587263a1624c153fc95af9))

## [0.12.1](https://github.com/nicknisi/diffdad/compare/v0.12.0...v0.12.1) (2026-07-10)


### Bug Fixes

* **cli:** stop sending temperature to Anthropic models ([#47](https://github.com/nicknisi/diffdad/issues/47)) ([64a7699](https://github.com/nicknisi/diffdad/commit/64a7699090157e1a21586b64189d90168e8b5610))
* stop losing reviews mid-flight and quiet false-positive narrative validation ([#50](https://github.com/nicknisi/diffdad/issues/50)) ([2606fbd](https://github.com/nicknisi/diffdad/commit/2606fbdbdd32dba6b6238466bc1bac4e56d29016))

## [0.12.0](https://github.com/nicknisi/diffdad/compare/v0.11.1...v0.12.0) (2026-07-07)


### Features

* Settings page: in-app config with live daemon re-wire ([#45](https://github.com/nicknisi/diffdad/issues/45)) ([b409892](https://github.com/nicknisi/diffdad/commit/b40989292d438268de3db62f9f50c69de1084552))

## [0.11.1](https://github.com/nicknisi/diffdad/compare/v0.11.0...v0.11.1) (2026-07-07)


### Bug Fixes

* **daemon:** survive launchd's bare PATH + stop hiding the no-GitHub state ([#43](https://github.com/nicknisi/diffdad/issues/43)) ([c19beb1](https://github.com/nicknisi/diffdad/commit/c19beb1ed9097dfd1d21f9a8b1e11dd96babe717))

## [0.11.0](https://github.com/nicknisi/diffdad/compare/v0.10.0...v0.11.0) (2026-07-06)


### Features

* per-machine daemon + agent review loop ([#38](https://github.com/nicknisi/diffdad/issues/38)) ([7f63138](https://github.com/nicknisi/diffdad/commit/7f63138361c45b65a987b203d1398574371a1c14))
* review-loop robustness — legible doors, comment delivery, presence, app-data storage ([#40](https://github.com/nicknisi/diffdad/issues/40)) ([631eaa9](https://github.com/nicknisi/diffdad/commit/631eaa9e4988b490c405e5e9752488c0b3862340))

## [0.10.0](https://github.com/nicknisi/diffdad/compare/v0.9.1...v0.10.0) (2026-05-09)


### Features

* Add narrative validation and error reporting ([#31](https://github.com/nicknisi/diffdad/issues/31)) ([a360c5c](https://github.com/nicknisi/diffdad/commit/a360c5c6263662db11ab19a07848a434b19c6a24))
* dual-publish formula to homebrew-formulae ([#35](https://github.com/nicknisi/diffdad/issues/35)) ([1e407ca](https://github.com/nicknisi/diffdad/commit/1e407caddb3afbe4d50d0f981958ce96679bb469))
* provider-keyed narrative cache and streaming partials ([#30](https://github.com/nicknisi/diffdad/issues/30)) ([d85fb06](https://github.com/nicknisi/diffdad/commit/d85fb062c15554926c86cae828c5dc73c1aa48de))

## [0.9.1](https://github.com/nicknisi/diffdad/compare/v0.9.0...v0.9.1) (2026-05-06)


### Bug Fixes

* cache narratives by prompt-relevant PR metadata, not just SHA ([#32](https://github.com/nicknisi/diffdad/issues/32)) ([9576675](https://github.com/nicknisi/diffdad/commit/957667583d84358f3a600983ac8b309fbffd1c2b))

## [0.9.0](https://github.com/nicknisi/diffdad/compare/v0.8.0...v0.9.0) (2026-05-05)


### Features

* Add multi-line comments, concern dismissal, and AI summary drafting ([#26](https://github.com/nicknisi/diffdad/issues/26)) ([88250d7](https://github.com/nicknisi/diffdad/commit/88250d7623f3287107b39c42221612f1ec4e694a))
* **cli:** add a recap tab for orienting on in-flight PRs ([#27](https://github.com/nicknisi/diffdad/issues/27)) ([7f0e3c2](https://github.com/nicknisi/diffdad/commit/7f0e3c254aeaf7df7d29b8ec93058aa968ddb271))
* live narrative progress, brevity, and defensive prompt caps ([#23](https://github.com/nicknisi/diffdad/issues/23)) ([f9ca00f](https://github.com/nicknisi/diffdad/commit/f9ca00ff7d033fba5f058864b40d95a14f50f1c0))
* research-grounded narrative overhaul — concerns, reading plan, streaming, eval ([#22](https://github.com/nicknisi/diffdad/issues/22)) ([3628dcc](https://github.com/nicknisi/diffdad/commit/3628dcc098bf07260659be2340802f548e7f3b9c))


### Bug Fixes

* **web:** keep loading screen until narrative is fully generated ([#28](https://github.com/nicknisi/diffdad/issues/28)) ([9227344](https://github.com/nicknisi/diffdad/commit/9227344bc586a2b02e46a66893b5c57d03ccb50f))

## [0.8.0](https://github.com/nicknisi/diffdad/compare/v0.7.0...v0.8.0) (2026-05-03)


### Features

* **cli:** add `dad config show` and `dad config reset` ([#19](https://github.com/nicknisi/diffdad/issues/19)) ([b71d5e4](https://github.com/nicknisi/diffdad/commit/b71d5e4e730c7fd376a11954338e61fe18a0b8aa))
* **cli:** configurable default CLI and per-CLI model ([#17](https://github.com/nicknisi/diffdad/issues/17)) ([13c017a](https://github.com/nicknisi/diffdad/commit/13c017ae2b7e54a1342c3c4647f24a6228c65ea3))


### Bug Fixes

* allow commenting on removed lines ([#18](https://github.com/nicknisi/diffdad/issues/18)) ([b06cee4](https://github.com/nicknisi/diffdad/commit/b06cee4105ae7e37c2251270df9044ebc0a708b7))

## [0.7.0](https://github.com/nicknisi/diffdad/compare/v0.6.1...v0.7.0) (2026-05-03)


### Features

* add @diffdad/site marketing site ([#9](https://github.com/nicknisi/diffdad/issues/9)) ([8d5d4f0](https://github.com/nicknisi/diffdad/commit/8d5d4f018574f08302439c420338e5e86cd656e7))


### Bug Fixes

* anchor inline comments to the changed line, not the context above ([#13](https://github.com/nicknisi/diffdad/issues/13)) ([6225d99](https://github.com/nicknisi/diffdad/commit/6225d99825bd2ddf862faa1843aee71f97c1e228))
* enable horizontal scroll for long diff lines ([#11](https://github.com/nicknisi/diffdad/issues/11)) ([36ba892](https://github.com/nicknisi/diffdad/commit/36ba8923717e27e2c4d1c6a39329a6bf8ce080b5))
* track repo at root with exclude-paths ([#14](https://github.com/nicknisi/diffdad/issues/14)) ([4ff43fc](https://github.com/nicknisi/diffdad/commit/4ff43fc21042b6083ab265753309e82916acd203))
