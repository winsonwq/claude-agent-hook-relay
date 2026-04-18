# Contributing to claude-agent-hook-relay

## Development Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/claude-agent-hook-relay.git
cd claude-agent-hook-relay

# Install dependencies
npm install

# Start development server
npm run dev

# Run linter
npm run lint

# Build
npm run build
```

## Code Style

- Follow the rules in `AGENTS.md`
- Run `npm run lint` before committing
- Use `npm run lint:fix` to auto-fix issues

## Commit Messages

Follow Conventional Commits:

```
feat: add new forwarder for Kafka
fix: handle missing session_id gracefully
docs: update API documentation
refactor: extract common logic to utils
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linter
5. Submit a PR with a clear description

## Issues

- Bug reports: include reproduction steps
- Feature requests: describe the use case
- Questions: use GitHub Discussions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
