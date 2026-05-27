# OIjudger

OIjudger is a VSCode extension for local OI-style sample judging.

First-version features:

- Initialize `.oitest/config.json`
- Create a problem without immediately binding a source file
- Bind a local statement file (`.md`, `.pdf`, or `.txt`) to a problem
- Add one or more C++ programs to a problem and choose a default program
- Add multiple samples under `.oitest/samples` or `.oitest/problems/<problemId>/samples`
- Add samples by pasting text or selecting input/output files
- Batch add samples from a folder by matching input and answer suffixes
- Delete samples from the OIjudger sidebar
- Set time and memory limits
- Automatically set Windows MinGW/g++ stack size from the memory limit
- Detect or select a local C++ compiler
- Compile the active C++ file with `g++`
- Run all configured samples
- Compare standard output
- Save user output and `.oitest/outputs/report.json`
- Show an `OIjudger` sidebar with current file, limits, sample status, and quick actions
- Open report and sample detail pages from the sidebar
- Switch UI text with `oijudger.language` (`auto`, `en`, `zh`)
- Manage multiple problems in one workspace with `.oitest/problems.json`
- Keep legacy single-problem `.oitest/config.json` data intact and import it when needed

Problem workflow:

- `OIjudger: Create Problem` creates a problem entry and its `.oitest/problems/<problemId>/` folders without requiring a source file.
- `OIjudger: Bind Statement` links a statement file. OIjudger stores the original file path only; it does not copy, modify, or delete the statement file.
- `OIjudger: Add Program To Problem` links a C++ program. Programs are path references only; source files are not copied into `.oitest`.
- `OIjudger: Set Default Program` chooses the program used by `Run All Samples`.
- `OIjudger: Run Samples With Program` lets you temporarily choose any linked or newly selected `.cpp` file for one run.
- `OIjudger: Add Problem From Current File` and `OIjudger: Add Problem From File` still work as shortcuts: they create a problem and set the selected file as the default program.

Tree view:

- Problem nodes are collapsed by default to keep the OIjudger sidebar compact after VSCode restarts.
- Expand a problem manually to view Statement, Programs, Limits, Samples, and Actions.
- Samples and Actions are also collapsed by default, which keeps large multi-sample problems easier to scan.

Sample storage:

- Paste manually: OIjudger stores the input and expected output inside `.oitest`. This is best for small samples.
- Select input/output files: OIjudger stores the original absolute file paths and does not copy the files. This is best for large data files or existing local test data.
- External samples depend on the original files. If an external input or answer file is moved or deleted, the sample is shown as `Missing` and skipped during judging.
- Deleting a managed sample removes the OIjudger-owned `.oitest` sample files and generated outputs.
- Deleting an external sample removes only the OIjudger sample record and generated outputs. The original input and answer files are never deleted.

Batch add samples:

- Run `OIjudger: Batch Add Samples`.
- Enter the input file suffix. The default is `.in`; `in` is normalized to `.in`.
- Enter the answer file suffix. The default is `.out`; `ans` is normalized to `.ans`.
- Select a samples folder.
- OIjudger scans only the first level of that folder and matches files by `basename + inputSuffix` and `basename + answerSuffix`.
- For example, `1.in` with `1.out` and `2.in` with `2.out` are added as two samples.
- Batch-added samples are external samples: OIjudger stores absolute paths only and does not copy or modify the files.
- Inputs without matching answer files and duplicate sample pairs are skipped and summarized.

Sample names:

- Manually pasted samples keep the default `Sample x` name.
- Samples added from files use the input file basename as the visible sample name.
- For example, `book3.in` with `book3.ans` is shown as `book3`; `1.in` with `1.out` is shown as `1`.
- Batch-added samples use each matched basename as the sample name.
- OIjudger still uses a stable internal `id` and `index` for output folders such as `outputs/sample-7/`, so display names do not affect deletion, reports, or diff paths.
- If a sample name already exists, OIjudger appends ` (2)`, ` (3)`, and so on.

Sample viewing:

- Sample input, expected output, and user output open in the native VSCode text editor.
- Output differences open with the native VSCode Diff Editor.
- New per-problem runs save user output as `.oitest/problems/<problemId>/outputs/sample-x/useroutput.txt`, with `stderr.txt` and `diff.txt` next to it.
- Older `1.out`, `1.err`, and `1.diff` outputs remain readable for compatibility.

Timing note: sample time only measures the user executable process. On Windows, sample time includes process startup and pipe I/O overhead, so very small programs may still show tens of milliseconds.

计时说明：样例时间只统计用户程序进程运行阶段。在 Windows 上，样例运行时间包含进程启动和管道 I/O 开销，因此极小程序也可能显示几十毫秒。

Windows stack size:

- Deep recursive programs on Windows may exit with `0xC00000FD`, which is a stack overflow exception.
- By default, OIjudger follows the problem memory limit and adds a MinGW/g++ linker flag when compiling on Windows.
- For `memoryMb = 256`, the generated flag is `-Wl,--stack,268435456`.
- Use `OIjudger: Set Stack Size` to choose `Follow Memory Limit`, `Custom Stack Size`, or `Disable Auto Stack Size`.
- The stack flag is generated at compile time and is not repeatedly inserted into `compile.args`.
- If auto stack size is enabled, an existing `-Wl,--stack,...` argument is replaced by the current setting. If auto stack size is disabled, OIjudger does not add a stack flag.
- This mainly targets Windows + MinGW/g++. Linux/macOS judging environments usually control stack through the runner or system limits, and avoiding very deep recursion is still the safest algorithmic choice.

Runtime Error Explanation:

- OIjudger explains common Runtime Error results from the process exit code or POSIX signal.
- Runtime Error names use common OI/OJ-style English descriptions, such as:
  - Stack overflow
  - Access violation
  - Integer divide by zero
  - Floating point exception
  - Segmentation fault
- Chinese UI keeps the English Runtime Error title and adds Chinese descriptions, possible causes, and suggestions below it.
- Common Windows examples:
  - `0xC00000FD`: Stack overflow
  - `0xC0000005`: Access violation
  - `0xC0000094`: Integer divide by zero
- Common Linux/macOS signals:
  - `SIGSEGV`: Segmentation fault
  - `SIGFPE`: Floating point exception
  - `SIGABRT`: Aborted
- The explanation is a diagnostic hint, not a final proof. Always combine it with the input file, stderr, the reproduction command, and a debugger when needed.

Commands:

- `OIjudger: Init Problem`
- `OIjudger: Add Sample`
- `OIjudger: Run All Samples`
- `OIjudger: Set Time Limit`
- `OIjudger: Set Memory Limit`
- `OIjudger: Set Stack Size`
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
