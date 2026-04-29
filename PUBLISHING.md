# Publishing to npm with GitHub OIDC

This project is configured for npm Trusted Publishing through GitHub Actions OIDC.
No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed for the publish workflow.

The workflow file is:

```text
.github/workflows/publish.yml
```

The npm package name is currently:

```text
t212
```

As of the latest local check, `t212` was not published on npm. Re-check before the first
publish:

```sh
pnpm view t212 name version
```

An npm `E404` means the name is still unclaimed or private/inaccessible to you.

## Repository Metadata

npm provenance validation requires `package.json` `repository.url` to exactly match the
GitHub repository that publishes the package. This local directory is not currently a Git
repository, so the final URL could not be inferred.

After creating the GitHub repository, add the exact repository metadata:

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

## One-Time npm Setup

npm Trusted Publishing is configured from the package settings page on npmjs.com. If the
package does not exist yet, you may need one initial manual publish using your npm account
before the settings page exists.

Before any publish:

```sh
pnpm install
pnpm run ci
pnpm publish:dry-run
```

Inspect the dry-run file list carefully. The package should include source, generated
OpenAPI types, the vendored OpenAPI spec, README, publishing guide, and license.

If local npm commands fail with cache ownership errors, fix the npm cache ownership or
temporarily use a clean cache for validation:

```sh
NPM_CONFIG_CACHE=/tmp/t212-npm-cache pnpm publish:dry-run
```

## Bootstrap If the Package Does Not Exist Yet

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

1. Open the `t212` package page.
2. Go to `Settings`.
3. Find `Trusted Publisher`.
4. Choose `GitHub Actions`.
5. Enter these values:

```text
Organization or user: OWNER
Repository: REPO
Workflow filename: publish.yml
Environment name: leave blank
```

Use only the workflow filename, not `.github/workflows/publish.yml`.

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

The publish workflow runs only when a GitHub Release is published.

1. Update `package.json` version:

```sh
npm version patch --no-git-tag-version
```

Use `minor` or `major` instead of `patch` when appropriate.

2. Run checks:

```sh
pnpm run ci
pnpm publish:dry-run
```

3. Commit the version change:

```sh
git add package.json pnpm-lock.yaml
git commit -m "Release v$(node -p "require('./package.json').version")"
```

4. Create and push a matching tag:

```sh
version="$(node -p "require('./package.json').version")"
git tag "v$version"
git push origin main
git push origin "v$version"
```

5. In GitHub, create a Release for that exact tag and publish it.

The workflow validates that the GitHub release tag, without the leading `v`, exactly
matches `package.json` version. For example:

```text
tag: v0.1.0
package.json version: 0.1.0
```

If they do not match, publishing stops before `npm publish`.

## Troubleshooting

If npm returns `ENEEDAUTH` or says it cannot authenticate:

- Confirm npm Trusted Publisher has `Workflow filename: publish.yml`.
- Confirm the workflow file is actually `.github/workflows/publish.yml`.
- Confirm `permissions.id-token: write` is present in the workflow.
- Confirm the workflow ran on `ubuntu-latest`, not a self-hosted runner.
- Confirm `package.json` `repository.url` exactly matches the GitHub repository.
- Confirm the npm package name in `package.json` is the package where Trusted Publishing
  was configured.

If provenance is missing:

- The GitHub repository must be public.
- The npm package must be public.
- Publishing must happen through Trusted Publishing, not a local token.

References:

- npm Trusted Publishing: https://docs.npmjs.com/trusted-publishers
- npm provenance: https://docs.npmjs.com/generating-provenance-statements
