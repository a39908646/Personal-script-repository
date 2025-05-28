#!/usr/bin/env node
/**
 * 万能的福利吧论坛签到脚本
 * cron: 0 8 * * *
 * new Env('福利吧论坛签到');
 */
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// 检查是否在青龙环境中
const IS_QINGLONG = fs.existsSync("/ql") || fs.existsSync("/ql/data");

// 多账号支持，使用@分隔多个cookie
let cookies_arr = [];
if (process.env.FULI_COOKIE) {
  if (process.env.FULI_COOKIE.includes("@")) {
    cookies_arr = process.env.FULI_COOKIE.split("@");
  } else {
    cookies_arr = [process.env.FULI_COOKIE];
  }
}

// 支持多个域名自动切换，从第一个开始尝试直到找到可用的
const BASE_URLS = [
  "https://www.wnflb2023.com/",
  "https://www.nflb99.com",
  "https://www.nflb.com",
  "https://wonderfulday.levi.com"
];

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36";
const result_list = [];
const DEBUG_MODE = false;

class Env {
  constructor(name) {
    this.name = name;
    this.startTime = Date.now();
  }
  log(...args) {
    console.log(...args);
  }
  wait(seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }
  done() {
    const costTime = (Date.now() - this.startTime) / 1000;
    console.log(`⏱️ ${this.name}执行完毕，耗时 ${costTime.toFixed(2)} 秒`);
  }
  static isNode() {
    return IS_QINGLONG;
  }
}
const env = new Env("福利签到论坛");

function debugLog(message) {
  if (DEBUG_MODE) {
    console.log(`[DEBUG] ${message}`);
  }
}

// 提取formhash
function extractFormhash(html) {
  const patterns = [
    /name="formhash"\svalue="([^"]+)"/,
    /formhash=([a-zA-Z0-9]+)/,
    /"formhash"\s*:\s*"([^"]+)"/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) {
      debugLog(`提取到formhash: ${match[1]}`);
      return match[1];
    }
  }
  return null;
}

// 提取用户ID
function extractUserId(html, cookie) {
  const patterns = [
    /uid=(\d+)/,
    /space-uid-(\d+)\.html/,
    /_sid=(\w+)/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) {
      debugLog(`提取到用户ID: ${match[1]}`);
      return match[1];
    }
  }
  // 尝试从cookie
  const uidMatch = /_sid=(\w+)/.exec(cookie);
  if (uidMatch) {
    return uidMatch[1];
  }
  return null;
}

// 提取用户信息
function extractUserInfo(html) {
  const info = {
    username: '',
    user_id: '',
    user_group: '',
    points: 0,
    coins: 0,
    last_visit: '',
    last_ip: ''
  };
  // 用户名
  let match = /用户名[:：]?\s*([^\s<]+)/.exec(html);
  if (match) info.username = match[1];
  // 用户组
  match = /用户组[:：]?\s*([^\s<]+)/.exec(html);
  if (match) info.user_group = match[1];
  // 积分
  match = /积分[:：]?\s*(\d+)/.exec(html);
  if (match) info.points = parseInt(match[1]);
  // 金币
  match = /金币[:：]?\s*(\d+)/.exec(html);
  if (match) info.coins = parseInt(match[1]);
  // 最后访问
  match = /最后访问[:：]?\s*([^\s<]+)/.exec(html);
  if (match) info.last_visit = match[1];
  // 最后IP
  match = /最后IP[:：]?\s*([^\s<]+)/.exec(html);
  if (match) info.last_ip = match[1];
  return info;
}

// 解析签到结果
function parseCheckinResult(html) {
  const result = {
    is_checked: false,
    days: 0,
    total_days: 0,
    points: 0
  };
  if (/签到成功|已签到/.test(html)) {
    result.is_checked = true;
  }
  let match = /已连续签到(\d+)天/.exec(html);
  if (match) result.days = parseInt(match[1]);
  match = /累计签到(\d+)天/.exec(html);
  if (match) result.total_days = parseInt(match[1]);
  match = /积分\+(\d+)/.exec(html);
  if (match) result.points = parseInt(match[1]);
  return result;
}

// 检查域名可用性
async function checkSiteAvailability(url, axiosInstance) {
  try {
    const res = await axiosInstance.get(url, { timeout: 10000 });
    if (res.status === 200) {
      debugLog(`网站 ${url} 可以访问`);
      return true;
    }
    debugLog(`网站 ${url} 返回状态码: ${res.status}`);
    return false;
  } catch (error) {
    debugLog(`网站 ${url} 访问异常: ${error.message}`);
    return false;
  }
}

// 发送通知（适配新版青龙）
async function sendNotify(title, content) {
  if (IS_QINGLONG) {
    try {
      let qlNotifyPath = "/ql/scripts/sendNotify.js";
      if (!fs.existsSync(qlNotifyPath)) {
        qlNotifyPath = "/ql/data/scripts/sendNotify.js";
      }
      if (fs.existsSync(qlNotifyPath)) {
        const notify = require(qlNotifyPath);
        if (notify && typeof notify.sendNotify === 'function') {
          await notify.sendNotify(title, content);
          console.log("青龙通知发送成功");
          return true;
        }
      }
    } catch (e) {
      console.log("调用 sendNotify.js 失败: " + e.message);
    }
  }
  console.log("通知模块不存在，无法发送通知");
  return false;
}

// 签到主流程
async function checkin(cookie, accountName) {
  const axiosInstance = axios.create({
    headers: {
      'User-Agent': USER_AGENT,
      'Cookie': cookie,
      'Accept-Language': 'zh-CN,zh;q=0.8,zh-TW;q=0.7,en-US;q=0.3,en;q=0.2',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    },
    timeout: 15000,
    maxRedirects: 5
  });

  let userInfo = { username: accountName, user_group: "未知", points: 0, coins: 0, last_visit: "未知", last_ip: "未知" };
  let workingBaseUrl = null;
  for (const url of BASE_URLS) {
    debugLog(`尝试访问域名: ${url}`);
    if (await checkSiteAvailability(url, axiosInstance)) {
      workingBaseUrl = url;
      debugLog(`发现可用域名: ${workingBaseUrl}`);
      break;
    }
  }
  if (!workingBaseUrl) {
    throw new Error("所有域名均无法访问，请检查网络或更新域名列表");
  }
  axiosInstance.defaults.headers.common["Referer"] = workingBaseUrl;

  // 1. 获取formhash
  console.log(`${accountName}: 正在获取formhash...`);
  const listUrl = `${workingBaseUrl}/plugin.php?id=fx_checkin%3Alist`;
  debugLog(`请求列表页面: ${listUrl}`);
  const listRes = await axiosInstance.get(listUrl);
  let formhash = extractFormhash(listRes.data);
  if (!formhash) {
    if (listRes.data.includes("请先登录后才能继续浏览")) {
      throw new Error("Cookie已失效，请重新获取");
    }
    debugLog(`未找到formhash，尝试其他方法...`);
    const homeRes = await axiosInstance.get(workingBaseUrl);
    formhash = extractFormhash(homeRes.data);
    if (!formhash) {
      throw new Error("未找到formhash，请检查站点结构或Cookie有效性");
    }
  }
  console.log(`${accountName}: 成功获取formhash: ${formhash}`);

  // 2. 获取用户ID和信息
  try {
    const userId = extractUserId(listRes.data, cookie);
    if (userId) {
      console.log(`${accountName}: 获取到用户ID: ${userId}`);
      const spaceUrl = `${workingBaseUrl}/space-uid-${userId}.html`;
      const spaceRes = await axiosInstance.get(spaceUrl);
      if (spaceRes.status === 200) {
        const extractedInfo = extractUserInfo(spaceRes.data);
        Object.assign(userInfo, extractedInfo);
        console.log(`${accountName}: 成功获取用户信息`);
      }
    }
  } catch (error) {
    console.log(`${accountName}: 获取用户信息失败 - ${error.message}`);
  }

  // 3. 签到
  console.log(`${accountName}: 正在签到...`);
  const checkinUrl = `${workingBaseUrl}/plugin.php?id=fx_checkin%3Acheckin&formhash=${formhash}&${formhash}=&infloat=yes&handlekey=fx_checkin&inajax=1&ajaxtarget=fwin_content_fx_checkin`;
  debugLog(`签到请求URL: ${checkinUrl}`);
  let checkinRes;
  try {
    checkinRes = await axiosInstance.get(checkinUrl, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': '*/*'
      }
    });
    debugLog(`签到请求状态码: ${checkinRes.status}`);
  } catch (error) {
    if (error.response) {
      debugLog(`签到请求异常，响应状态码: ${error.response.status}`);
      if (error.response.data && error.response.data.includes("已签到")) {
        console.log(`${accountName}: 已经签到过了`);
      } else {
        debugLog(`签到请求异常响应内容: ${error.response.data ? error.response.data.substring(0, 200) : "无响应内容"}`);
        throw new Error(`签到请求失败: ${error.message}`);
      }
    } else {
      debugLog(`签到请求没有响应: ${error.message}`);
      throw error;
    }
  }

  // 4. 验证签到结果
  console.log(`${accountName}: 正在验证签到结果...`);
  const listRes2 = await axiosInstance.get(`${workingBaseUrl}/plugin.php?id=fx_checkin%3Alist`);
  const checkinResult = parseCheckinResult(listRes2.data);
  if (checkinResult.is_checked) {
    let msg = `✅ ${accountName}: 签到成功!\n`;
    if (userInfo.username && userInfo.username !== accountName) msg += `👤 用户名: ${userInfo.username}\n`;
    if (userInfo.user_group && userInfo.user_group !== "未知") msg += `👑 用户等级: ${userInfo.user_group}\n`;
    if (userInfo.points) msg += `📊 积分: ${userInfo.points}\n`;
    if (userInfo.coins) msg += `💰 金币: ${userInfo.coins}\n`;
    if (userInfo.last_visit && userInfo.last_visit !== "未知") msg += `⏱️ 最后访问: ${userInfo.last_visit}\n`;
    if (userInfo.last_ip && userInfo.last_ip !== "未知") msg += `🌐 访问IP: ${userInfo.last_ip}\n`;
    msg += `📅 已连续签到${checkinResult.days}天\n`;
    msg += `📆 累计签到${checkinResult.total_days}天\n`;
    msg += `⬆️ 本次积分+${checkinResult.points}`;
    console.log(`${accountName}: 签到成功! 已连续签到${checkinResult.days}天，累计签到${checkinResult.total_days}天，积分+${checkinResult.points}`);
    return msg;
  } else {
    if (checkinRes && checkinRes.status === 200) {
      console.log(`${accountName}: 签到可能成功，但未检测到签到标记`);
      return `⚠️ ${accountName}: 签到可能成功，但未检测到签到确认信息`;
    } else {
      throw new Error("未找到签到成功信息，签到失败");
    }
  }
}

// 随机延迟函数
function randomWait(min = 3, max = 8) {
  const ms = Math.floor(Math.random() * (max - min + 1) + min) * 1000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 主函数
async function main() {
  if (cookies_arr.length === 0) {
    console.log("请先设置环境变量 FULI_COOKIE");
    return;
  }
  console.log(`共${cookies_arr.length}个账号`);
  for (let i = 0; i < cookies_arr.length; i++) {
    const accountName = `账号${i + 1}`;
    console.log(`\n开始【${accountName}】签到`);
    try {
      const msg = await checkin(cookies_arr[i], accountName);
      result_list.push(msg);
    } catch (error) {
      const errmsg = error.message;
      console.log(`${accountName}签到失败: ${errmsg}`);
      result_list.push(`${accountName}签到失败: ${errmsg}`);
    }
    // 账号之间添加随机延迟
    if (i < cookies_arr.length - 1) {
      const waitSec = Math.floor(Math.random() * 5) + 3;
      console.log(`等待${waitSec}秒后进行下一个账号签到...`);
      await randomWait(3, 8);
    }
  }
  // 发送通知
  if (IS_QINGLONG && result_list.length > 0) {
    try {
      await sendNotify("福利吧论坛签到", result_list.join("\n\n"));
    } catch (error) {
      console.log(`发送通知失败: ${error.message}`);
    }
  }
  env.done();
}

// 执行主函数
main().catch(error => {
  console.log(`执行脚本异常: ${error.message}`);
  process.exit(1);
});
