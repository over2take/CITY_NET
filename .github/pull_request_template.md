## Summary
<!-- Describe what changed and why -->

## Test plan
<!-- How should this be tested? -->
- [ ] Tested locally
- [ ] Tests pass

## Pre-merge checklist

**Code quality:**
- [ ] Code follows project style
- [ ] No breaking changes (or clearly documented)
- [ ] No console errors or warnings

**Version & Release:**
- [ ] **Version bumped?** If releasing to users, update:
  - [ ] `frontend/package.json` version
  - [ ] `docker-compose.yml` `APP_VERSION`
  - [ ] `CHANGELOG.md` with release notes
- [ ] GitHub Actions will auto-tag Docker images with the new version

**Before merging to main:**
- [ ] All tests passing
- [ ] PR reviewed and approved
- [ ] Branch is up to date with main
- [ ] No merge conflicts

## Related issues
<!-- Link any related issues: Fixes #123 -->
