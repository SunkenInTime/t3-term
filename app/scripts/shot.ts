// Launch t3-term under gpuix automation and write PNG screenshots.
// bun scripts/shot.ts <out-dir> [steps.json]
// steps: [{click: testId}|{clickText: text}|{press: "ctrl-k"}|{fill:[testId,text]}|{wait: ms}|{shot: name}|{mouse:[x,y]}
//         |{hover:[x,y]}|{hoverTestId: testId}|{hoverText: text}|{rightClick:[x,y]}|{rightClickText: text}
//         |{wheel:[x,y,dy]}|{wheelXY:[x,y,dx,dy]}|{mouseMods:[x,y,"shift"]}|{dblclick:[x,y]}|{dblclickText: text}
//         |{wheelTestId:[testId,dx,dy]}|{dragTestId:[testId,dx,dy]}|{rightClickTestId: testId}|{tryClick: testId}]
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connectStdio } from "@gpuix/react/automation";

const outDir = process.argv[2] ?? "screenshots";
const steps = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : [{ wait: 4000 }, { shot: "app" }];
mkdirSync(outDir, { recursive: true });
// automation's launch() pipes the app's stderr without reading it; once the
// pipe buffer fills, the app blocks mid-frame and every step times out. Spawn
// it here and drain stderr into <out-dir>/app-stderr.log.
const child = spawn("bun", ["src/main.tsx", ...(process.env.T3TERM_ARGS ?? "").split(" ").filter(Boolean)], {
  cwd: join(import.meta.dir, ".."),
  env: { ...process.env, GPUIX_BACKGROUND: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.pipe(createWriteStream(join(outDir, "app-stderr.log")));
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
try {
  for (const step of steps) {
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
    if (step.rightClick) await app.mouse.click({ x: step.rightClick[0], y: step.rightClick[1] }, { button: 2 });
    if (step.wheel) await app.mouse.wheel({ x: step.wheel[0], y: step.wheel[1] }, 0, step.wheel[2]);
    if (step.wheelXY) await app.mouse.wheel({ x: step.wheelXY[0], y: step.wheelXY[1] }, step.wheelXY[2], step.wheelXY[3]);
    if (step.fill) await app.getByTestId(step.fill[0]).fill(step.fill[1]);
    if (step.press) await app.getByTestId(step.target ?? "composer").press(step.press);
    if (step.wheelTestId) await app.getByTestId(step.wheelTestId[0]).wheel(step.wheelTestId[1], step.wheelTestId[2]);
    if (step.dragTestId) await app.getByTestId(step.dragTestId[0]).dragBy(step.dragTestId[1], step.dragTestId[2], { steps: 8 });
    if (step.rightClickTestId) await app.getByTestId(step.rightClickTestId).click({ button: 2 });
    if (step.shot) {
      const path = join(outDir, `${step.shot}.png`);
      await app.screenshot({ path });
      console.log("shot", path);
    }
  }
} finally {
  await app.close();
}
