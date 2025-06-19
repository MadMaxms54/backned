import { WebSocketServer } from 'ws';
import { decodeMessage, encodeMessage } from './shared.js';

export function createServer(options = {}) {
  const wss = new WebSocketServer(options);

  wss.on('connection', (ws) => {
    ws._listeners = {};

    ws.on('message', (message) => {
      const msg = decodeMessage(message);
      if (msg && ws._listeners[msg.event]) {
        ws._listeners[msg.event].forEach(fn => fn(msg.data));

        if (msg.data && msg.data._ackId) {
          ws.send(encodeMessage(`${msg.event}_ack_${msg.data._ackId}`, { status: 'received' }));
        }
      }
    });

    ws.emit = function(event, data) {
      this.send(encodeMessage(event, data));
    };

    ws.onEvent = function(event, handler) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);
    };

    if (wss._onConnect) {
      wss._onConnect(ws);
    }
  });

  wss.onClient = function(handler) {
    this._onConnect = handler;
  };

  return wss;
} 
