import { spawn } from "node:child_process"

let test = spawn("echo", ["this is a test"], { stdio: "inherit" })
console.log(test)