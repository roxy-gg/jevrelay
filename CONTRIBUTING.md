# Contributing

## Setup

```sh
npm install
npx playwright install chromium
npm run check
```

## Principles

- Keep browser and computer execution local.
- Keep the runtime provider-neutral.
- Do not accept provider secrets through MCP tool arguments.
- Prefer declarative, validated operations over arbitrary code execution.
- Add new adapter powers deliberately and document their permissions.
- Stop rather than guess when a decision does not meet its confidence threshold.

## Pull Requests

Include tests for runtime, schema, or provider behavior and run:

```sh
npm run format
npm run check
```
