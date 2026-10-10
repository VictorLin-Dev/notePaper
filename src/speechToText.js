"use strict";
import fs from "fs";
import { spawn } from "child_process";
import * as OpenCC from "opencc-js";

const toTraditional = OpenCC.Converter({ from: "cn", to: "twp" });
const MODEL_PATH = "models/ggml-large-v3-turbo-q5_0.bin";
const SERVER_URL = "http://127.0.0.1:8080";
const SRCDATA_PATH = "data/srcdata/speechToText.json";

let serverProcess = null;   // 放在函式外面，所有函式共用
let srcdata = fs.existsSync(SRCDATA_PATH)
    ? JSON.parse(fs.readFileSync(SRCDATA_PATH, "utf8"))
    : {};
let lineCounter = srcdata.lineCounter ?? 0;   // 接續上次的行編號


process.on("exit", () => {
    if (serverProcess) serverProcess.kill();
});

// 檢查 server 有沒有開
async function isServerUp() {
    try {
        await fetch(SERVER_URL, { signal: AbortSignal.timeout(1000) });
        return true;
    } catch {
        return false;
    }
}

// 啟動 server，等到它準備好才返回
async function startServer() {
    if (await isServerUp()) return;

    if (!serverProcess) {
        serverProcess = spawn(
            "whisper-server",
            ["-m", MODEL_PATH, "--port", "8080"],
            { stdio: "ignore" }
        );
    }

    for (let i = 0; i < 60; i++) {
        if (await isServerUp()) return;
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error("whisper-server no activate for time out 30s");
}

// 關閉由本程式啟動的 server
async function stopServer() {
    if (!serverProcess) return;
    const proc = serverProcess;
    serverProcess = null;
    const exited = new Promise(r => proc.once("exit", r));
    proc.kill();
    await exited;
}

async function restartServer() {
    await stopServer();
    await startServer();
}

// 把 wav 音訊檔辨識成逐字稿
async function transcribe(wavPath) {
    await startServer();

    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(wavPath)]), "audio.wav");
    form.append("response_format", "text"); // 回傳格式設為 verbose_json（含時間戳與分句）
    form.append("temperature", "0"); // 辨識隨機程度，0 代表輸出最穩定
    form.append("language", "zh");
    form.append("prompt", "繁體中文 課堂內容 包含 English terms");

    // 發 post request 給本地語言辨識 server
    const res = await fetch(SERVER_URL + "/inference", {
        method: "POST",
        body: form
    });
    if (res.ok) return res.text();
    else throw new Error(`speech to text POST ERROR ${res.status}`);
}

// 轉繁體、去掉空行、每行加上接續的編號，合成一個字串
function addNumberInLine(text) {
    return toTraditional(text)
        .split("\n")
        .filter(line => line.trim() !== "")
        .map(line => `[${lineCounter++}] ${line.trim()}`)
        .join("\n");
}

// 把行編號存回 json，下次執行時接續
function saveSrcData() {
    srcdata.lineCounter = lineCounter;
    fs.writeFileSync(SRCDATA_PATH, JSON.stringify(srcdata, null, 2));
}

const result = await transcribe("data/audio/clip60.wav"); //實際實行邏輯
saveSrcData();

fs.mkdirSync("data/transcripts", { recursive: true });
fs.appendFileSync("data/transcripts/clip60.txt", addNumberInLine(result) + "\n");
saveSrcData();
process.exit(0);
