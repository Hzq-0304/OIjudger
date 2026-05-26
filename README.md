# OIjudger

OIjudger is a VSCode extension for local OI-style sample judging.

First-version features:

- Initialize `.oitest/config.json`
- Add multiple samples under `.oitest/samples`
- Set time and memory limits
- Compile the active C++ file with `g++`
- Run all configured samples
- Compare standard output
- Save user output and `.oitest/outputs/report.json`
- Show an `OIjudger` sidebar with current file, limits, sample status, and quick actions
- Open report and sample detail pages from the sidebar

Commands:

- `OIjudger: Init Problem`
- `OIjudger: Add Sample`
- `OIjudger: Run All Samples`
- `OIjudger: Set Time Limit`
- `OIjudger: Set Memory Limit`
- `OIjudger: Open Last Report`
- `OIjudger: Clear Outputs`

The default compiler command is `g++`. You can edit `.oitest/config.json` to adjust compiler flags.

## Development

From the project root:

```powershell
npm install
npm run compile
npm pack --dry-run
```

Press F5 in VSCode and choose `Run OIjudger Extension` to open the Extension Development Host.
