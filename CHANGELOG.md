# Changelog

## [0.1.1](https://github.com/rishitank/holocron/compare/v0.1.0...v0.1.1) (2026-02-23)


### 🚀 Features

* benchmark suite + FTS5 file-path tokenization ([e224b46](https://github.com/rishitank/holocron/commit/e224b4695419ed989575ad18a555d756863ca9ab))
* Claude Code marketplace plugin — zero-install distribution via npx ([e5eb832](https://github.com/rishitank/holocron/commit/e5eb832fdf49ac85cb937d9e8d07bc4ecd73a908))
* complete MVP implementation with production hardening and benchmark suite ([4d03d7c](https://github.com/rishitank/holocron/commit/4d03d7cc97dfa9f32b6d2ad84d59176667846434))
* Engram-inspired memory architecture + FTS5 camelCase fix (schema v3) ([c70022f](https://github.com/rishitank/holocron/commit/c70022fb18453f88bda229e2d1a780ed11d1e8cb))
* rename darth-proxy → holocron ([7baf55e](https://github.com/rishitank/holocron/commit/7baf55e2aa49a959356fb34e6c6759cdfc026feb))


### 🐛 Bug Fixes

* exclude type-only and CLI entry-point files from coverage ([8771434](https://github.com/rishitank/holocron/commit/8771434d8c833561d152475ece16440926b90d95))
* extract PR number from release-please v4 JSON output ([9747fb4](https://github.com/rishitank/holocron/commit/9747fb40c84098b82714dc30602e2d6370746942))
* use gh pr merge --auto for release PR instead of direct merge ([f982927](https://github.com/rishitank/holocron/commit/f9829273f002e193a557fe01bb221142506b855b))
* zero lint errors — eslint strict-TypeScript compliance ([f8a4e21](https://github.com/rishitank/holocron/commit/f8a4e2107c3b19f0a84a109e29f73c46aa1b562f))


### ⚡ Performance

* replace OramaIndex+SqliteVectorStore with FTS5 hybrid store ([cfd5768](https://github.com/rishitank/holocron/commit/cfd576883a5373039e65fc7edfd3d046127afc24))


### 🔧 CI/CD

* add workflow_dispatch trigger to CI workflow ([17dc304](https://github.com/rishitank/holocron/commit/17dc304ab4c1a1f78a4419e13e9a9bc4f6214643))
* align with standard repo patterns (release-please, split CI jobs, branch ruleset) ([05e14fb](https://github.com/rishitank/holocron/commit/05e14fbae484790f0293c713c38d9ec36ade217f))
* automated releases via semantic-release + fix bin path in package.json ([4f15c15](https://github.com/rishitank/holocron/commit/4f15c150a019ee5a3bababc50e74582f9f804fb7))
* switch npm publishing to OIDC trusted publishing (no token required) ([a275372](https://github.com/rishitank/holocron/commit/a27537298e52cb8b04bd55572edeaf4d3be494e3))


### 📦 Build

* **deps-dev:** Bump @types/node from 22.19.11 to 25.3.0 ([#8](https://github.com/rishitank/holocron/issues/8)) ([f4b2f60](https://github.com/rishitank/holocron/commit/f4b2f60ea512627f045857d11ce4f3a59413ebfb))
* **deps:** Bump commander from 12.1.0 to 14.0.3 ([#5](https://github.com/rishitank/holocron/issues/5)) ([e912786](https://github.com/rishitank/holocron/commit/e9127863116c035e23b9ba8d2b5be6605bf818fb))
* **deps:** Bump simple-git from 3.31.1 to 3.32.2 ([#4](https://github.com/rishitank/holocron/issues/4)) ([04ef066](https://github.com/rishitank/holocron/commit/04ef0660d6b6088daada842f60061476b672fd54))

## 1.0.0 (2026-02-23)


### Features

* benchmark suite + FTS5 file-path tokenization ([e224b46](https://github.com/rishitank/holocron/commit/e224b4695419ed989575ad18a555d756863ca9ab))
* Claude Code marketplace plugin — zero-install distribution via npx ([e5eb832](https://github.com/rishitank/holocron/commit/e5eb832fdf49ac85cb937d9e8d07bc4ecd73a908))
* complete MVP implementation with production hardening and benchmark suite ([4d03d7c](https://github.com/rishitank/holocron/commit/4d03d7cc97dfa9f32b6d2ad84d59176667846434))
* Engram-inspired memory architecture + FTS5 camelCase fix (schema v3) ([c70022f](https://github.com/rishitank/holocron/commit/c70022fb18453f88bda229e2d1a780ed11d1e8cb))
* rename darth-proxy → holocron ([7baf55e](https://github.com/rishitank/holocron/commit/7baf55e2aa49a959356fb34e6c6759cdfc026feb))


### Performance Improvements

* replace OramaIndex+SqliteVectorStore with FTS5 hybrid store ([cfd5768](https://github.com/rishitank/holocron/commit/cfd576883a5373039e65fc7edfd3d046127afc24))
