# Exam Upload Assistant

## Status: Version 1 Complete

This repository contains a private Chrome Extension that assists with uploading multiple-choice questions to an internal company website. Version 1 is feature-complete and live-tested end to end. See [CHANGELOG.md](CHANGELOG.md) for the release notes and the Version 2 roadmap.

## Overview

The extension is a **semi-automatic guided browser assistant**, not a fully autonomous automation tool. It loads a local Markdown file of MCQ questions and guides a human operator through creating each one on the target site, one Execute Step at a time. The human always remains in control: images, tags, and the AI-generated explanation are all reviewed or inserted manually, and every automated action requires an explicit Execute Step press to proceed to the next one.

## Documentation

- [context.md](context.md) — product scope, philosophy, workflow, and state machine reference.
- [architecture.md](architecture.md) — how the extension is actually built: module responsibilities, the selector-descriptor system, the DOM automation techniques used, major architectural decisions, and the major bugs encountered and solved during Version 1.
- [Implementation.md](Implementation.md) — the phase-by-phase build record.
- [development-rules.md](development-rules.md) — coding conventions and rules, still in effect for Version 2 development.
- [CHANGELOG.md](CHANGELOG.md) — release history and the Version 2 roadmap.

This project follows a phased implementation strategy; read the documentation above before making changes.

## Development Workflow

Every implementation session follows this process:

1. Read all project documentation.
2. Implement only the requested phase.
3. Explain the implementation.
4. Provide a manual testing checklist.
5. Stop and wait for approval.

Never continue automatically. This discipline was followed for the entire Version 1 build and continues to apply to Version 2.
