// Launch t3-term under gpuix automation and write PNG screenshots.
// bun scripts/shot.ts <out-dir> [steps.json]
// steps: [{click: testId}|{clickText: text}|{press: "ctrl-k"}|{fill:[testId,text]}|{wait: ms}|{shot: name}|{mouse:[x,y]}
//         |{hover:[x,y]}|{hoverTestId: testId}|{hoverText: text}|{rightClick:[x,y]}|{rightClickText: text}
//         |{wheel:[x,y,dy]}|{wheelXY:[x,y,dx,dy]}|{mouseMods:[x,y,"shift"]}|{dblclick:[x,y]}|{dblclickText: text}
//         |{wheelTestId:[testId,dx,dy]}|{dragTestId:[testId,dx,dy]}|{dragXY:[x1,y1,x2,y2]}|{rightClickTestId: testId}|{tryClick: testId}
//         |{keys: "g p u"} (key-downs to whatever has focus, without focusing a target first)
//         |{keyUp: "backspace"} (a key release; `keys` sends none)
//         |{tree: name} (writes the retained element tree to <out-dir>/<name>.tree.json)
//         |{perf: "label"} / {perfEnd: true} (phase markers for T3TERM_PERF=<dir>, see src/dev/perfProbe.ts)
//         |{repeat: n, every: ms, steps: [...]} (runs steps n times, `every` ms apart; `$i` in strings is the index, "=expr" strings evaluate to numbers)]
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { constants, setPriority } from "node:os";
import { join } from "node:path";
import { connectStdio } from "@gpuix/react/automation";

const outDir = process.argv[2] ?? "screenshots";
const steps = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : [{ wait: 4000 }, { shot: "app" }];
mkdirSync(outDir, { recursive: true });
// automation's launch() pipes the app's stderr without reading it; once the
// pipe buffer fills, the app blocks mid-frame and every step times out. Spawn
// it here and drain stderr into <out-dir>/app-stderr.log.
// T3TERM_BIN runs a compiled binary instead of the source.
const appArgs = (process.env.T3TERM_ARGS ?? "").split(" ").filter(Boolean);
const [command, ...commandArgs] = process.env.T3TERM_BIN
  ? [process.env.T3TERM_BIN, ...appArgs]
  : ["bun", "src/main.tsx", ...appArgs];
const child = spawn(command!, commandArgs, {
  cwd: join(import.meta.dir, ".."),
  env: { ...process.env, GPUIX_BACKGROUND: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.pipe(createWriteStream(join(outDir, "app-stderr.log")));
// T3TERM_PRIORITY=above keeps perf numbers comparable while other work loads the machine.
if (process.env.T3TERM_PRIORITY === "above" && child.pid) setPriority(child.pid, constants.priority.PRIORITY_ABOVE_NORMAL);
const app = await connectStdio({
  write: (chunk) => {
    child.stdin.write(chunk);
  },
  feed: (listener) => {
    child.stdout.on("data", (buf: Buffer) => listener(buf.toString("utf8")));
  },
  close: async () => {
    child.kill();
  },
});
const perfDir = process.env.T3TERM_PERF?.trim();
let perfSeq = 0;
// Wall-clock send time of every input step in the current perf phase; the
// probe measures latency from these.
let perfSends: number[] = [];
const nonInputSteps = new Set(["wait", "shot", "tree", "perf", "perfEnd", "repeat", "every", "steps", "target"]);
const perfCommand = async (command: string) => {
  if (!perfDir) return;
  if (command === "end") writeFileSync(join(perfDir, "sends.json"), JSON.stringify(perfSends));
  else perfSends = [];
  writeFileSync(join(perfDir, "ctl.txt"), `${++perfSeq} ${command}
`);
  // The probe polls every 20 ms.
  await Bun.sleep(80);
};
const substitute = (value: unknown, index: number): unknown =>
  typeof value === "string"
    ? value.startsWith("=")
      ? // "=200+$i*20": arithmetic on the index, for sweeps
        Number(new Function(`return (${value.slice(1).replaceAll("$i", String(index))})`)())
      : value.replaceAll("$i", String(index))
    : Array.isArray(value)
      ? value.map((item) => substitute(item, index))
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, index)]))
        : value;
async function runSteps(list: any[]) {
  for (const step of list) {
    if (step.perf) await perfCommand(`phase ${step.perf}`);
    if (step.layout) await perfCommand(`layout ${step.layout}`);
    if (step.perfEnd) await perfCommand("end");
    if (Object.keys(step).some((key) => !nonInputSteps.has(key))) perfSends.push(performance.timeOrigin + performance.now());
    if (step.repeat) {
      for (let index = 0; index < step.repeat; index++) {
        const started = performance.now();
        await runSteps(substitute(step.steps, index) as any[]);
        const left = (step.every ?? 0) - (performance.now() - started);
        if (left > 0) await Bun.sleep(left);
      }
    }
    if (step.wait) await Bun.sleep(step.wait);
    if (step.click) await app.getByTestId(step.click).click();
    // Clicks only if present: for prompts that may or may not appear (approvals).
    if (step.tryClick) await app.getByTestId(step.tryClick).click().catch(() => console.log("tryClick: no", step.tryClick));
    if (step.clickText) await app.getByText(step.clickText).click();
    if (step.mouse) await app.mouse.click({ x: step.mouse[0], y: step.mouse[1] });
    if (step.mouseMods) await app.mouse.click({ x: step.mouseMods[0], y: step.mouseMods[1] }, { modifiers: step.mouseMods[2] });
    if (step.hover) await app.mouse.move({ x: step.hover[0], y: step.hover[1] });
    if (step.hoverTestId) await app.getByTestId(step.hoverTestId).hover();
    if (step.hoverText) await app.getByText(step.hoverText).hover();
    if (step.dblclick) {
      await app.mouse.click({ x: step.dblclick[0], y: step.dblclick[1] });
      await app.mouse.click({ x: step.dblclick[0], y: step.dblclick[1] });
    }
    if (step.dblclickText) {
      const target = app.getByText(step.dblclickText);
      await app.mouse.click(target);
      await app.mouse.click(target);
    }
    if (step.type) await app.getByTestId(step.type[0]).fill(step.type[1]);
    if (step.rightClickText) await app.mouse.click(app.getByText(step.rightClickText), { button: 2 });
    // {pressXY:[x,y,button]}: a separate press and release, for surfaces the click shortcut misses.
    if (step.pressXY) {
      const point = { x: step.pressXY[0], y: step.pressXY[1] };
      // GPUI hit-tests a press at the last pointer position, so move there first.
      await app.mouse.move(point);
      await app.mouse.down(point, { button: step.pressXY[2] ?? 0 });
      await app.mouse.up(point, { button: step.pressXY[2] ?? 0 });
    }
    if (step.rightClick) await app.mouse.click({ x: step.rightClick[0], y: step.rightClick[1] }, { button: 2 });
    if (step.wheel) await app.mouse.wheel({ x: step.wheel[0], y: step.wheel[1] }, 0, step.wheel[2]);
    if (step.wheelXY) await app.mouse.wheel({ x: step.wheelXY[0], y: step.wheelXY[1] }, step.wheelXY[2], step.wheelXY[3]);
    if (step.fill) await app.getByTestId(step.fill[0]).fill(step.fill[1]);
    if (step.keys) await (app as unknown as { call: (method: string, params: object) => Promise<unknown> }).call("keystrokes", { keys: step.keys });
    if (step.keyUp) await (app as unknown as { call: (method: string, params: object) => Promise<unknown> }).call("keyUp", { key: step.keyUp });
    if (step.press) await app.getByTestId(step.target ?? "composer").press(step.press);
    if (step.wheelTestId) await app.getByTestId(step.wheelTestId[0]).wheel(step.wheelTestId[1], step.wheelTestId[2]);
    // A press-move-release between two window points (a text selection, say).
    if (step.dragXY) await app.mouse.drag({ x: step.dragXY[0], y: step.dragXY[1] }, { x: step.dragXY[2], y: step.dragXY[3] }, { steps: 8 });
    if (step.dragTestId) await app.getByTestId(step.dragTestId[0]).dragBy(step.dragTestId[1], step.dragTestId[2], { steps: 8 });
    if (step.rightClickTestId) await app.getByTestId(step.rightClickTestId).click({ button: 2 });
    if (step.tree) {
      const { tree } = await (app as unknown as { call: (method: string, params: object) => Promise<{ tree: unknown }> }).call("getTree", {});
      writeFileSync(join(outDir, `${step.tree}.tree.json`), JSON.stringify(tree));
    }
    if (step.shot) {
      const path = join(outDir, `${step.shot}.png`);
      await app.screenshot({ path });
      console.log("shot", path);
    }
  }
}
try {
  await runSteps(steps);
} finally {
  await app.close();
}
