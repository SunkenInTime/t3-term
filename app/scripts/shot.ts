// Launch t3-term under gpuix automation and write PNG screenshots.
// bun scripts/shot.ts <out-dir> [steps.json]
// steps: [{click: testId}|{clickText: text}|{press: "ctrl-k"}|{fill:[testId,text]}|{wait: ms}|{shot: name}|{mouse:[x,y]}
//         |{wheel:[testId,dx,dy]}|{drag:[testId,dx,dy]}|{hover: testId}|{rightClick: testId}]
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launch } from "@gpuix/react/automation";

const outDir = process.argv[2] ?? "screenshots";
const steps = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], "utf8")) : [{ wait: 4000 }, { shot: "app" }];
mkdirSync(outDir, { recursive: true });
const app = await launch({
  command: "bun",
  args: ["src/main.tsx", ...(process.env.T3TERM_ARGS ?? "").split(" ").filter(Boolean)],
  cwd: join(import.meta.dir, ".."),
  env: { ...process.env, GPUIX_BACKGROUND: "1" },
});
try {
  for (const step of steps) {
    if (step.wait) await Bun.sleep(step.wait);
    if (step.click) await app.getByTestId(step.click).click();
    if (step.clickText) await app.getByText(step.clickText).click();
    if (step.mouse) await app.mouse.click(step.mouse[0], step.mouse[1]);
    if (step.fill) await app.getByTestId(step.fill[0]).fill(step.fill[1]);
    if (step.press) await app.getByTestId(step.target ?? "composer").press(step.press);
    if (step.wheel) await app.getByTestId(step.wheel[0]).wheel(step.wheel[1], step.wheel[2]);
    if (step.drag) await app.getByTestId(step.drag[0]).dragBy(step.drag[1], step.drag[2], { steps: 8 });
    if (step.hover) await app.getByTestId(step.hover).hover();
    if (step.rightClick) await app.getByTestId(step.rightClick).click({ button: 2 });
    if (step.shot) {
      const path = join(outDir, `${step.shot}.png`);
      await app.screenshot({ path });
      console.log("shot", path);
    }
  }
} finally {
  await app.close();
}
