(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.LightWS = {}));
})(this, (function (exports) { 'use strict';

  function encodeMessage(event, data) {
    return JSON.stringify({ event, data });
  }

  function decodeMessage(msg) {
    try {
      return JSON.parse(msg);
    } catch (e) {
      return null;
    }
  }

  function createClient(url, options = {}) {
    const {
      reconnect = true,
      reconnectInterval = 2000,
      maxRetries = 10,
      debug = false,
    } = options;

    let socket;
    const listeners = {};
    let isConnected = false;
    let retryCount = 0;

    function log(...args) {
      if (debug) console.log('[WebSocketClient]', ...args);
    }

    function connect() {
      socket = new WebSocket(url);

      socket.onopen = () => {
        isConnected = true;
        retryCount = 0;
        log('Connected');
        if (listeners['connect']) listeners['connect'].forEach(fn => fn());
      };

      socket.onmessage = (e) => {
        const msg = decodeMessage(e.data);
        if (msg && listeners[msg.event]) {
          listeners[msg.event].forEach(fn => fn(msg.data));
        }
      };

      socket.onerror = (err) => {
        if (listeners['error']) listeners['error'].forEach(fn => fn(err));
      };

      socket.onclose = () => {
        isConnected = false;
        log('Disconnected');
        if (listeners['disconnect']) listeners['disconnect'].forEach(fn => fn());
        if (reconnect && retryCount < maxRetries) {
          retryCount++;
          setTimeout(() => connect(), reconnectInterval * retryCount);
        }
      };
    }

    connect();

    return {
      emit(event, data) {
        if (isConnected) socket.send(encodeMessage(event, data));
      },

      emitWithAck(event, data, timeout = 2000) {
        return new Promise((resolve, reject) => {
          const id = Date.now().toString();
          const ackEvent = `${event}_ack_${id}`;

          const handler = (res) => {
            resolve(res);
            this.off(ackEvent);
          };

          this.on(ackEvent, handler);
          this.emit(event, { ...data, _ackId: id });

          setTimeout(() => {
            this.off(ackEvent);
            reject('Timeout');
          }, timeout);
        });
      },

      on(event, handler) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(handler);
      },

      once(event, handler) {
        const wrapper = (data) => {
          handler(data);
          this.off(event, wrapper);
        };
        this.on(event, wrapper);
      },

      off(event, handler) {
        if (!listeners[event]) return;
        if (!handler) {
          delete listeners[event];
        } else {
          listeners[event] = listeners[event].filter(fn => fn !== handler);
        }
      },

      getStatus() {
        return isConnected ? 'connected' : 'disconnected';
      }
    };
  }

  exports.createClient = createClient;

}));
//# sourceMappingURL=client.umd.js.map
