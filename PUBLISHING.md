# Publishing to npm with release-please and GitHub OIDC

This project publishes `t212-cli` to npm with:

- release-please for version bumps, changelog updates, tags, and GitHub releases.
- GitHub Actions OIDC for npm Trusted Publishing.
- A GitHub Environment named `npm` for deployment visibility and optional publish gates.
- No long-lived `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret.

The release workflow is:

```text
.github/workflows/release-please.yml
```

The release-please configuration files are:

```text
release-please-config.json
.release-please-manifest.json
```

## Package And Repository

The npm package name is:

```text
t212-cli
```

The GitHub repository is:

```text
lmammino/t212
```

The package exposes two equivalent binaries:

```text
t212
t212-cli
```

Re-check package availability before the first publish:

```sh
pnpm view t212-cli name version
```

An npm `E404` means the name is still unclaimed or private/inaccessible to you.

## Repository Metadata

npm provenance validation requires `package.json` `repository.url` to match the GitHub
repository that publishes the package. This package is configured with:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/lmammino/t212.git"
  },
  "bugs": {
    "url": "https://github.com/lmammino/t212/issues"
  },
  "homepage": "https://github.com/lmammino/t212#readme"
}
```

If the GitHub repository changes, update the package metadata:

```sh
npm pkg set repository.type=git
npm pkg set repository.url=git+https://github.com/OWNER/REPO.git
npm pkg set bugs.url=https://github.com/OWNER/REPO/issues
npm pkg set homepage=https://github.com/OWNER/REPO#readme
pnpm format
pnpm run ci
```

Replace `OWNER/REPO` with the exact GitHub owner and repository name. Case matters for npm
Trusted Publishing checks.

## Why Publishing Is In The release-please Workflow

release-please uses `GITHUB_TOKEN` by default. GitHub does not start new workflow runs from
events created by `GITHUB_TOKEN`, so a separate `on: release` publish workflow would not
reliably run after release-please creates a GitHub release.

For that reason, `.github/workflows/release-please.yml` creates the release and then a
separate `publish` job publishes to npm when a release was created.

The `publish` job uses the GitHub Environment named `npm`, with this environment URL:

```text
https://www.npmjs.com/package/t212-cli
```

This makes npm publication visible in GitHub Deployments and allows optional environment
protection rules.

## Configure The GitHub npm Environment

In GitHub:

1. Open `Settings` for `lmammino/t212`.
2. Go to `Environments`.
3. Create an environment named exactly:

```text
npm
```

4. Do not add npm tokens or npm secrets.
5. Optional: add required reviewers if you want a manual approval gate before npm publish.

If you add required reviewers, the workflow will still create the GitHub release first,
then pause at the `publish` job until the environment is approved. If you want fully
automated releases, leave the `npm` environment without required reviewers.

## One-Time npm Setup

npm Trusted Publishing is configured from the package settings page on npmjs.com. If the
package does not exist yet, you may need one initial manual publish using your npm account
before the settings page exists.

Before any publish:

```sh
pnpm install
pnpm run ci
NPM_CONFIG_CACHE=/tmp/t212-npm-cache pnpm publish:dry-run
```

Inspect the dry-run file list carefully. The package should include `dist/` compiled
JavaScript, the vendored OpenAPI spec, README, publishing guide, and license. It should not
rely on TypeScript source execution from `node_modules`.

If local npm commands fail with cache ownership errors, fix the npm cache ownership or use
a clean cache for validation:

```sh
NPM_CONFIG_CACHE=/tmp/t212-npm-cache pnpm publish:dry-run
```

## Bootstrap If The Package Does Not Exist Yet

Use this only for the first publish if npm does not let you configure Trusted Publishing
before the package exists.

1. Make sure `package.json` has the final `repository.url`.
2. Log in locally with your npm account:

```sh
npm login
```

3. Publish the first public version:

```sh
npm publish --access public
```

4. Immediately continue with the Trusted Publishing setup below.
5. After Trusted Publishing works, remove or revoke any temporary publish tokens you created.

Do not add npm tokens to GitHub repository secrets for this project.

## Configure Trusted Publishing on npm

On npmjs.com:

1. Open the `t212-cli` package page.
2. Go to `Settings`.
3. Find `Trusted Publisher`.
4. Choose `GitHub Actions`.
5. Enter these values:

```text
Organization or user: lmammino
Repository: t212
Workflow filename: release-please.yml
Environment name: npm
```

Use only the workflow filename, not `.github/workflows/release-please.yml`.
The environment name must match the job environment in GitHub Actions exactly.

The workflow must run on GitHub-hosted runners. Self-hosted runners are not currently
supported for npm Trusted Publishing.

## Recommended npm Hardening

After the first successful OIDC publish:

1. Go to the package `Settings` on npmjs.com.
2. Open `Publishing access`.
3. Select `Require two-factor authentication and disallow tokens`.
4. Save the setting.
5. Revoke any old npm automation tokens that can publish this package.

Trusted Publishing will continue to work because it uses OIDC, not traditional tokens.

## Release Process

After release-please is merged to `main`, do not manually run `npm version`, create release
tags, or create GitHub releases for normal releases.

Use Conventional Commit messages:

```text
fix: correct order payload validation
feat: add portfolio summary command
feat!: change default output schema
```

SemVer mapping:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `feat!:` or a `BREAKING CHANGE:` footer creates a major release.

Normal release flow:

1. Merge feature/fix PRs into `main` using Conventional Commit messages.
2. The `Release Please` workflow opens or updates a release PR.
3. Review the release PR. It should update `package.json`, `pnpm-lock.yaml`,
   `.release-please-manifest.json`, and `CHANGELOG.md`.
4. Merge the release PR.
5. The `Release Please` workflow runs on `main`, creates the GitHub release/tag, runs CI,
   verifies package contents, and publishes `t212-cli` to npm via OIDC.

You can also run the `Release Please` workflow manually from GitHub Actions if needed.

## Notes About Checks On release-please PRs

Because this setup uses the default `GITHUB_TOKEN`, pull request workflows may not run
automatically for release PRs created by release-please. This is a GitHub security
behavior, not a release-please bug.

If you require automated PR checks on release-please PRs, use a GitHub App token or PAT for
release-please. This project intentionally avoids that by publishing in the same workflow
and keeping npm publishing tokenless through OIDC.

## Troubleshooting

If npm returns `ENEEDAUTH` or says it cannot authenticate:

- Confirm npm Trusted Publisher has `Workflow filename: release-please.yml`.
- Confirm npm Trusted Publisher has `Environment name: npm`.
- Confirm the workflow file is actually `.github/workflows/release-please.yml`.
- Confirm `permissions.id-token: write` is present in the workflow.
- Confirm the workflow ran on `ubuntu-latest`, not a self-hosted runner.
- Confirm the GitHub Environment is named exactly `npm`.
- Confirm `package.json` `repository.url` exactly matches the GitHub repository.
- Confirm the npm package name in `package.json` is the package where Trusted Publishing
  was configured.

If release-please does not open a release PR:

- Confirm commits use Conventional Commit messages.
- Confirm the workflow is present on `main`.
- Confirm repository settings allow GitHub Actions to create pull requests.
- Check the `Release Please` workflow logs.

If no npm package is published after merging a release PR:

- Confirm the `Release Please` workflow created a release.
- Confirm the workflow reached the `Publish to npm with OIDC` step.
- Confirm npm Trusted Publishing points to `release-please.yml` and environment `npm`, not
  `publish.yml` with a blank environment.
- Confirm `NPM_TOKEN`/`NODE_AUTH_TOKEN` are not required or configured.

If provenance is missing:

- The GitHub repository must be public.
- The npm package must be public.
- Publishing must happen through Trusted Publishing, not a local token.

References:

- release-please action: https://github.com/googleapis/release-please-action
- npm Trusted Publishing: https://docs.npmjs.com/trusted-publishers
- npm provenance: https://docs.npmjs.com/generating-provenance-statements
