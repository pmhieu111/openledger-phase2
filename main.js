const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const { HttpsProxyAgent } = require("https-proxy-agent");
const readline = require("readline");
const user_agents = require("./config/userAgents.js");
const settings = require("./config/config.js");
const { sleep, loadData, getRandomNumber, saveToken, isTokenExpired, saveJson } = require("./utils.js");
const { checkBaseUrl } = require("./checkAPI");
const { Wallet, ethers } = require("ethers");
const { jwtDecode } = require("jwt-decode");
const { v4: uuidv4 } = require("uuid");
let intervalIds = [];
class ClientAPI {
  constructor(itemData, accountIndex, proxy, baseURL, localStorage) {
    this.extensionId = "chrome-extension://ekbbplmjjgoobhdlffmgeokalelnmjjc";

    this.headers = {
      Accept: "*/*",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-Storage-Access": "active",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    };
    this.baseURL = baseURL;
    this.baseURL_v2 = "https://apitn.openledger.xyz/ext/api";

    this.itemData = itemData;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyIP = null;
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
    this.token = null;
    this.authInfo = null;
    this.localStorage = localStorage;
  }

  #load_session_data() {
    try {
      const filePath = path.join(process.cwd(), "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    console.log(`[Tài khoản ${this.accountIndex + 1}] Tạo user agent...`.blue);
    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(process.cwd(), "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Unknown";
  }

  #set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  createUserAgent() {
    try {
      this.session_name = this.itemData.address;
      this.#get_user_agent();
    } catch (error) {
      this.log(`Can't create user agent: ${error.message}`, "error");
      return;
    }
  }

  async log(msg, type = "info") {
    const accountPrefix = `[OpenLedger][Account ${this.accountIndex + 1}][${this.itemData.address}]`;
    let ipPrefix = "[Local IP]";
    if (settings.USE_PROXY) {
      ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : "[Unknown IP]";
    }
    let logMessage = "";

    switch (type) {
      case "success":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.green;
        break;
      case "error":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.red;
        break;
      case "warning":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.yellow;
        break;
      case "custom":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.magenta;
        break;
      default:
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.blue;
    }
    console.log(logMessage);
  }

  async checkProxyIP() {
    try {
      const proxyAgent = new HttpsProxyAgent(this.proxy);
      const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: proxyAgent });
      if (response.status === 200) {
        this.proxyIP = response.data.ip;
        return response.data.ip;
      } else {
        throw new Error(`Cannot check proxy IP. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error checking proxy IP: ${error.message}`);
    }
  }

  async makeRequest(
    url,
    method,
    data = {},
    options = {
      retries: 1,
      isAuth: false,
      extraHeaders: {},
    }
  ) {
    const { retries, isAuth, extraHeaders } = options;

    const headers = {
      ...this.headers,
      ...extraHeaders,
    };

    if (!isAuth) {
      headers["authorization"] = `Bearer ${this.token}`;
    }

    let proxyAgent = null;
    if (settings.USE_PROXY) {
      proxyAgent = new HttpsProxyAgent(this.proxy);
    }
    let currRetries = 0;
    do {
      try {
        const response = await axios({
          method,
          url: `${url}`,
          headers,
          timeout: 60000,
          ...(proxyAgent ? { httpsAgent: proxyAgent, httpAgent: proxyAgent } : {}),
          ...(method.toLowerCase() != "get" ? { data: JSON.stringify(data || {}) } : {}),
        });
        if (response?.data?.data) return { status: response.status, success: true, data: response.data.data };
        return { success: true, data: response.data, status: response.status };
      } catch (error) {
        const errorMessage = error?.response?.data?.error || error?.response?.data?.message || error.message;
        this.log(`Request failed: ${url} | ${error.message}...`, "warning");

        if (error.message.includes("stream has been aborted")) {
          return { success: false, status: error.status, data: null, error: errorMessage };
        }
        if (error.status == 401) {
          this.log(`Unauthorized: ${url}`);
          await sleep(1);
          process.exit(1);
        }
        if (error.status == 400) {
          this.log(`Invalid request for ${url}, maybe have new update from server | contact: https://t.me/airdrophuntersieutoc to get new update!`, "error");
          return { success: false, status: error.status, error: errorMessage };
        }
        if (error.status == 429) {
          this.log(`Rate limit ${error.message}, waiting 30s to retries`, "warning");
          await sleep(60);
        }
        await sleep(settings.DELAY_BETWEEN_REQUESTS);
        currRetries++;
        if (currRetries > retries) {
          return { status: error.status, success: false, error: errorMessage };
        }
      }
    } while (currRetries <= retries);
  }

  async auth() {
    return null;
    // const wallet = this.wallet;
    // const nonceRes = await this.getNonce();
    // if (!nonceRes.success) return { status: 500, success: false, error: "Can't get nonce" };

    // const signedMessage = await wallet.signMessage(nonceRes.nonce);
    const payload = { signature: "signedMessage", walletAddress: this.itemData.address };
    return this.makeRequest(`${this.baseURL}/v1/account/login`, "post", payload, { isAuth: true });
  }

  async getNonce() {
    return this.makeRequest(
      `${this.baseURL}/v1/account/nonce`,
      "post",
      {
        walletAddress: this.itemData.address,
      },
      { isAuth: true }
    );
  }

  async getBalance() {
    return this.makeRequest(`${this.baseURL}/v2/reward`, "get");
  }

  async getUserData() {
    return this.makeRequest(`${this.baseURL_v2}/v2/users/me`, "get");
  }

  // async getWokers() {
  //   return this.makeRequest(`${this.baseURL_v2}/v2/users/workers`, "get");
  // }

  async getRealTime() {
    return this.makeRequest(`${this.baseURL}/v2/reward_realtime`, "get");
  }

  async getHistoryReward() {
    return this.makeRequest(`${this.baseURL}/v2/reward_history`, "get");
  }

  async nodesCommunicate(payload) {
    return this.makeRequest(`${this.baseURL_v2}/v2/nodes/communicate`, "post", payload, {
      extraHeaders: {
        Origin: this.extensionId,
      },
    });
  }

  async checkinStatus() {
    return this.makeRequest(`${this.baseURL}/v2/claim_details`, "get");
  }

  async checkin(payload) {
    return this.makeRequest(`${this.baseURL}/v2/claim_reward`, "post", payload);
  }

  generateRegisterMessage(address, workerId, browserId, msgType) {
    return {
      workerID: workerId,
      msgType: msgType,
      workerType: "LWEXT",
      message: {
        id: browserId,
        type: msgType,
        worker: {
          host: this.extensionId,
          identity: workerId,
          ownerAddress: address,
          type: "LWEXT",
        },
      },
    };
  }

  generateHeartbeatMessage(address, workerId, msgType, memory, storage) {
    return {
      message: {
        Worker: {
          Identity: workerId,
          ownerAddress: address,
          type: "LWEXT",
          Host: this.extensionId,
          pending_jobs_count: 0,
        },
        Capacity: {
          AvailableMemory: memory,
          AvailableStorage: storage,
          AvailableGPU: "",
          AvailableModels: [],
        },
      },
      msgType: msgType,
      workerType: "LWEXT",
      workerID: workerId,
    };
  }

  generateBrowserId() {
    return uuidv4();
  }

  generateWorkerId(account) {
    return Buffer.from(account).toString("base64");
  }

  async getValidToken(isNew = false) {
    const existingToken = this.token;
    const { isExpired: isExp, expirationDate } = isTokenExpired(existingToken);

    this.log(`Access token status: ${isExp ? "Expired".yellow : "Valid".green} | Acess token exp: ${expirationDate}`);
    if (existingToken && !isNew && !isExp) {
      this.log("Using valid token", "success");
      return existingToken;
    }

    this.log("No found token or experied...", "warning");
    // const loginRes = await this.auth();
    // if (!loginRes.success) return null;
    // const newToken = loginRes.data;
    // if (newToken.success && newToken.data?.token) {
    //   saveJson(this.session_name, JSON.stringify(newToken.data), "tokens.json");
    //   return newToken.data.token;
    // }
    // this.log("Can't get new token...", "warning");
    return null;
  }

  async handleCheckin() {
    const resCheckin = await this.checkinStatus();
    if (!resCheckin.success) return this.log("Can't get checkin status...skipping", "warning");
    const dataCheckin = resCheckin.data;
    const isClaimed = dataCheckin?.claimed;
    const nextClaim = dataCheckin?.nextClaim;

    if (!isClaimed) {
      const payload = {
        signTx: "",
      };
      const resClaim = await this.checkin(payload);
    } else {
      this.log(`Next checkin is ${new Date(nextClaim).toLocaleString()}`, "warning");
    }
  }

  async handleCheckPoint() {
    this.log(`Sync checkpoint...`);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Đặt giờ về 0 để so sánh chỉ ngày

    let totalPoints = 0;
    const dataRealTime = await this.getRealTime();
    const dataHistory = await this.getHistoryReward();

    // Kiểm tra thành công của dữ liệu
    if (!dataRealTime.success || !dataHistory.success) {
      this.log(`Can't sync checkpoint`, "warning");
      return; // Dừng hàm nếu không thành công
    }

    // Tìm dữ liệu cho ngày hôm nay từ dataRealTime
    const entryToday = dataRealTime.data.find((entry) => {
      const entryDate = new Date(entry.date);
      entryDate.setHours(0, 0, 0, 0);
      return entryDate.getTime() === today.getTime();
    });

    // Tìm dữ liệu cho ngày hôm nay từ dataHistory
    const entryTodayHis = dataHistory.data.find((entry) => {
      const entryDate = new Date(entry.date);
      entryDate.setHours(0, 0, 0, 0);
      return entryDate.getTime() === today.getTime();
    });

    // Tính điểm nếu tìm thấy dữ liệu cho ngày hôm nay
    if (entryToday) {
      totalPoints += parseFloat(entryToday.total_heartbeats) || 0;
      totalPoints += parseFloat(entryToday.total_scraps) || 0;
      totalPoints += parseFloat(entryToday.total_prompts) || 0;

      // Nếu có dữ liệu lịch sử cho ngày hôm nay, cộng điểm
      if (entryTodayHis) {
        totalPoints += parseFloat(entryTodayHis.total_points) || 0;
      }

      this.log(`[${new Date().toLocaleString()}] Today earning: ${totalPoints || 0} | Recheck after an hour`, "success");
    } else {
      this.log(`No data  point found for today.`, "warning");
    }
  }

  async handleSyncData() {
    this.log(`Sync data...`);
    let userData = { success: true, data: null, status: 0 },
      retries = 0;

    do {
      userData = await this.getUserData();
      if (userData?.success) break;
      retries++;
    } while (retries < 1 && userData.status !== 400);
    if (userData.success) {
      const balanceData = await this.getBalance();
      const { referral_code } = userData.data;
      // const wokerData = await this.getWokers();

      const { name, point, totalPoint, endDate } = balanceData.data;
      this.log(`Ref code: ${referral_code} | Point ${name}: ${point} | Total points: ${totalPoint} | End date ${name}: ${endDate}`, "custom");
    } else {
      return this.log("Can't sync new data...skipping", "warning");
    }
    return userData;
  }

  async handleCreateDevice() {
    // const res = await this.getWokers();
    // if (!res.success) {
    //   this.log("Can't get or create device...skipping", "warning");
    //   return null;
    // }
    const workerId = this.generateWorkerId(this.session_name);
    const browserId = this.generateBrowserId();
    const memory = Math.round(Math.random() * 32 * 100) / 100;
    const storage = (Math.round(Math.random() * 500 * 100) / 100).toString();
    this.localStorage[this.session_name] = {
      ...(this.localStorage[this.session_name] || {}),
      workerId,
      browserId,
      memory,
      storage,
      address: this.session_name,
      token: this.token,
    };
    fs.writeFileSync("localStorage.json", JSON.stringify(this.localStorage, null, 2));

    return this.localStorage[this.session_name];
  }

  async handleHB() {
    let localItem = this.localStorage[this.session_name];
    if (!localItem?.workerId) {
      localItem = this.handleCreateDevice();
    }
    const { workerId, browserId, memory, storage, address } = localItem;

    for (const msgType of ["REGISTER", "HEARTBEAT"]) {
      if (msgType === "REGISTER") {
        const payload = this.generateRegisterMessage(address, workerId, browserId, msgType);
        const register = await this.nodesCommunicate(payload);
        if (register.success) {
          this.log(`Ping success!!!`, "success");
        } else {
          this.log(`Ping failed! | ${JSON.stringify(register)}`, "warning");
        }
        this.log(`[${new Date().toLocaleString()}] Wait For 5 Minutes For Next Ping...`);
        await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
      } else if (msgType === "HEARTBEAT") {
        const payload = this.generateHeartbeatMessage(address, workerId, msgType, memory, storage);
        while (true) {
          const heartbeat = await this.nodesCommunicate(payload);
          if (heartbeat) {
            this.log(`Ping success!!!`, "success");
          } else {
            this.log(`Ping failed! | ${JSON.stringify(heartbeat)}`, "warning");
          }
          this.log(`[${new Date().toLocaleString()}] Wait For 5 Minutes For Next Ping...`);
          await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
        }
      }
    }
  }

  async runAccount() {
    this.session_name = this.itemData.address;
    this.authInfo = this.localStorage[this.session_name] || {};
    this.token = this.authInfo?.token;
    this.#set_headers();
    if (settings.USE_PROXY) {
      try {
        this.proxyIP = await this.checkProxyIP();
      } catch (error) {
        this.log(`Cannot check proxy IP: ${error.message}`, "warning");
        return;
      }
      const timesleep = getRandomNumber(settings.DELAY_START_BOT[0], settings.DELAY_START_BOT[1]);
      this.log(`Bắt đầu sau ${timesleep} giây...`);
      await sleep(timesleep);
    }

    const token = await this.getValidToken();
    if (!token) return;
    const userData = await this.handleSyncData();
    if (userData.success) {
      // await this.handleCheckin();
      // await sleep(1);
      await this.handleCheckPoint();
      const interValCheckPoint = setInterval(() => this.handleCheckPoint(), 3600 * 1000);
      intervalIds.push(interValCheckPoint);
      if (settings.AUTO_MINING) {
        await this.handleHB();
        // await sleep(1);
        // await this.handleSyncData();
      }
    } else {
      this.log("Can't get use info...skipping", "error");
    }
  }
}

function stopInterVal() {
  if (intervalIds.length > 0) {
    for (const intervalId of intervalIds) {
      clearInterval(intervalId);
    }
    intervalIds = [];
  }
}

async function main() {
  console.log(colors.yellow("Tool được phát triển bởi nhóm tele Airdrop Hunter Siêu Tốc (https://t.me/airdrophuntersieutoc)"));

  const data = loadData("tokens.txt");
  const proxies = loadData("proxy.txt");
  let localStorage = JSON.parse(fs.readFileSync("localStorage.json", "utf8"));

  if (data.length == 0 || (data.length > proxies.length && settings.USE_PROXY)) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${data.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }
  if (!settings.USE_PROXY) {
    console.log(`You are running bot without proxies!!!`.yellow);
  }

  let maxThreads = settings.USE_PROXY ? settings.MAX_THEADS : settings.MAX_THEADS_NO_PROXY;

  const { endpoint, message } = await checkBaseUrl();
  if (!endpoint) return console.log(`Không thể tìm thấy ID API, thử lại sau!`.red);
  console.log(`${message}`.yellow);

  const itemDatas = data
    .map((val, index) => {
      const { exp, address } = jwtDecode(val);
      const item = {
        address: address,
        exp,
      };
      const localItem = localStorage[address];
      if (localItem && Math.floor(Date.now() / 1000 > exp)) {
        console.log(`${address} | Token expired, deleting...`.yellow);
        // delete localStorage[address];
        return null;
      } else {
        // let newArr = JSON.parse(localStorage[address] || "[{}]");
        localStorage[address] = {
          ...(localItem ? localItem : {}),
          token: val,
          address: address,
          exp,
        };
        fs.writeFileSync("localStorage.json", JSON.stringify(localStorage, null, 2));
      }
      return item;
    })
    .filter((i) => i !== null);

  process.on("SIGINT", async () => {
    console.log("Stopping...".yellow);
    stopInterVal();
    await sleep(1);
    process.exit();
  });

  await sleep(1);
  while (true) {
    // localStorage = JSON.parse(fs.readFileSync("localStorage.json", "utf8"));
    await sleep(2);
    for (let i = 0; i < itemDatas.length; i += maxThreads) {
      const batch = itemDatas.slice(i, i + maxThreads);

      const promises = batch.map(async (itemData, indexInBatch) => {
        const accountIndex = i + indexInBatch;
        const proxy = proxies[accountIndex] || null;
        const client = new ClientAPI(itemData, accountIndex, proxy, endpoint, localStorage);
        return client.runAccount();
      });
      await Promise.all(promises);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
