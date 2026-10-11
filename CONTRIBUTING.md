# Contributing to CardSpoke

Thank you for your interest in contributing to CardSpoke! This document outlines the process for contributing to this project.

## Contributor License Agreement

By submitting a contribution to this project, you agree to the following terms:

1. **License Grant**: You grant [JX Holdings, LLC](https://jxholdings.com) and [Jeffrey Guntly](https://github.com/jxburros) a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable license to use, reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute your contributions and such derivative works.

2. **Commercial Use**: You acknowledge and agree that [JX Holdings, LLC](https://jxholdings.com) retains the right to use your contributions in future commercial versions of CardSpoke. This includes, but is not limited to, paid versions, enterprise editions, or any other monetized offerings.

3. **Original Work**: You represent that your contributions are your original work and that you have the right to grant the licenses described above.

4. **Apache 2.0 License**: All contributions will be licensed under the Apache License 2.0, consistent with the project's license.

## How to Contribute

### Reporting Issues

- Use the GitHub issue tracker to report bugs or suggest features
- Check if the issue already exists before creating a new one
- Provide detailed information about the issue, including steps to reproduce

### Submitting Pull Requests

1. Fork the repository
2. Create a new branch for your feature or bugfix
3. Make your changes, following the coding standards of the project
4. Add or update tests as appropriate
5. Ensure all tests pass
6. Update documentation as needed
7. Submit a pull request with a clear description of the changes

### Code Style

- Follow the existing code style in the project
- Write clear, readable code with appropriate comments
- Keep commits focused and atomic

### Testing

- Write tests for new features
- Ensure all existing tests pass before submitting
- Run `npm test` to execute the test suite
- If you change anything under `www/src/` or `vite.config.js`, run `npm run build` and commit the regenerated `www/` output; CI fails when the committed bundle is out of date

Every pull request runs the `CI` workflow (`.github/workflows/ci.yml`): unit tests on Node 20/22/24, the production build plus a bundle-drift check, static smoke checks, the advanced plugin source check, a type-check of `types/index.d.ts`, the desktop shell unit tests, Markdown lint against `.markdownlint.jsonc`, and the Playwright browser QA (`npm run qa:browser`, `npm run qa:plugins`). All of these must pass before merge.

## Questions?

If you have any questions about contributing, please open an issue for discussion.

## Copyright

Copyright 2026 [Jeffrey Guntly](https://github.com/jxburros) ([JX Holdings, LLC](https://jxholdings.com))

This project is licensed under the Apache License 2.0. See the LICENSE file for details.
