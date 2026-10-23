// `import path from "./x.mp3" with { type: "file" }` resolves to a file path
// (embedded in a compiled binary).
declare module "*.mp3" {
  const path: string;
  export default path;
}
