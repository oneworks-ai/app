# Home Bridge

Home bridge imports common user skill roots into the project workspace asset graph.

Default roots:

- `~/.agents/skills`
- `~/.claude/skills`
- `~/.config/opencode/skills`
- `~/.gemini/skills`

Missing directories are skipped. Bridged skills are treated like workspace assets for selection, but project skills, plugin skills, and installed dependencies take priority over same-name home skills.

## Disable Home Bridge

```yaml
skills:
  homeBridge:
    enabled: false
```

## Override Roots

```yaml
skills:
  homeBridge:
    roots:
      - ~/.agents/skills
      - /opt/team-skills
```

`roots` supports absolute paths and paths starting with `~`.

Use home bridge for personal reusable skills. Use project-managed skills when the repository should own and review the skill set.
