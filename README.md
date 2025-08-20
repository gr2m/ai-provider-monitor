# AI Provider API Changes

A GitHub Actions-powered service that monitors API specification changes from major AI providers and automatically creates pull requests when changes are detected. As pull requests are merged, releases are created with use full release notes based on the pull request description.

Additionally, if you want to get notified about some or all new releases, you can install the [ai-provider-api-changes](https://github.com/apps/ai-provider-api-changes) app on any repository, which will create repository dispatch event named `ai-provider-api-change/[provider slug]/[version]`, e.g. `ai-provider-api-change/openai/1.2.3`.

The version follows [semantic versioning](https://semver.org/) in the form of `[breaking version].[feature version].[fix version]`. In most cases that means

- **breaking version bump**: An API change was introduced that breaks prior behavior. That shouldn't happen, but when it does it's worth paying attention to.
- **feature version bump**: Something was added: a new API endpoint, a new parameter, or a new option for an existing parameter.
- **fix version bump**: updates to documentation, or typos in the spec.

## License

[ISC](LICENSE)