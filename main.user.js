// ==UserScript==
// @name         B站评论优化
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  优化B站评论请求处理
// @author       uncharity
// @license      MIT
// @icon         https://www.bilibili.com/favicon.ico
// @match        https://www.bilibili.com/video/*
// @match        https://space.bilibili.com/*/dynamic
// @match        https://www.bilibili.com/bangumi/play/*
// @downloadURL  https://github.com/uncharity/BiliComment-/raw/main/main.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = Object.freeze({
    targetApis: [
      "api.bilibili.com/x/v2/reply/reply", //评论回复
      "api.bilibili.com/x/v2/reply/wbi/main", //评论
    ],
    targetMethod: "GET",
  });
  /**
   * 检查是否为目标请求
   * @param {string} url 请求URL
   * @param {string} method 请求方法
   * @returns {boolean}
   */
  function isTargetRequest(url, method) {
    return (
      CONFIG.targetApis.some(function (api) {
        return url.includes(api);
      }) && method === CONFIG.targetMethod
    );
  }
  /**
   * 处理评论数据
   * @param {Object} data 评论数据对象
   * @returns {Object} 处理后的评论数据对象
   */
  function processCommentData(data) {
    if (!data?.data?.replies?.length) {
      //没有评论数据
      return data;
    }
    data.data.replies.forEach(function (reply) {
      if (!reply?.content?.members?.length) return; //心理安慰
      const content = reply.content;
      const jump_url = content.jump_url;
      const jumps = Object.keys(jump_url);
      if (jumps.length) {
        jumps.forEach(function (key) {
          if (jump_url[key].pc_url) {
            delete jump_url[key];
          }
        });
      }
      if (!content.at_name_to_mid_str) {
        //没有被艾特用户数据
        return;
      }
      //{"name":"123456"}
      const name2mid = content.at_name_to_mid_str;
      //所有被艾特用户id与用户名
      //{"123456":"name"}
      const members = content.members.reduce(function (acc, user) {
        acc[user.mid] = user.uname;
        return acc;
      }, {});
      //所有更改了id的用户,原名与新名的对照表
      const replaces = Object.entries(name2mid).reduce(function (
        acc,
        [rawName, id]
      ) {
        const newName = members[id];
        if (rawName !== newName) {
          //如果原来的名字变更
          acc[rawName] = newName;
        }
        return acc;
      },
      {});
      if (Object.keys(replaces).length) {
        content.message = content.message.replace(
          /@([^@\s]+)/g,
          (match, name) => {
            return replaces[name] ? `@${replaces[name]}` : match;
          }
        );
        // 同步更新 at_name_to_mid 和 at_name_to_mid_str
        Object.entries(replaces).forEach(([oldName, newName]) => {
          if (content.at_name_to_mid[oldName]) {
            const mid = content.at_name_to_mid[oldName];
            delete content.at_name_to_mid[oldName];
            content.at_name_to_mid[newName] = mid;
          }
          if (content.at_name_to_mid_str[oldName]) {
            const midStr = content.at_name_to_mid_str[oldName];
            delete content.at_name_to_mid_str[oldName];
            content.at_name_to_mid_str[newName] = midStr;
          }
        });
      }
    });
    return data;
  }

  /**
   * 处理API响应数据
   * @param {Response} response - Fetch API的响应对象
   * @returns {Promise<Response>} 处理后的响应对象
   */
  async function handleResponse(response) {
    const originalData = await response.json();
    const processedData = processCommentData(originalData);
    return new Response(JSON.stringify(processedData), {
      status: response.status,
      headers: response.headers,
    });
  }

  const originalFetch = window.fetch;

  /**
   * 重写fetch方法以处理评论请求
   * @param {string|Request} resource - 请求URL或Request对象
   * @param {Object} [config] - fetch配置选项
   * @param {string} [config.method] - HTTP请求方法
   * @returns {Promise<Response>} fetch响应
   */
  window.fetch = async function (...args) {
    const [resource, config] = args;
    if (!isTargetRequest(resource, config?.method)) {
      return originalFetch.apply(this, args);
    }
    const response = await originalFetch.apply(this, args);
    return handleResponse(response);
  };
})();
