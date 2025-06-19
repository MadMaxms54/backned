# 🧩 socked

A lightweight JavaScript utility for WebSocket-based client-server communication with:

- ✅ Event-based messaging  
- 🔁 Reconnect with backoff strategy  
- 🧠 Acknowledged emits (emit + response)  
- 🔄 One-time listeners  
- 🫀 Ping/pong heartbeat (server-initiated)  
- 🧪 Debug logging & connection status API  

---

## Features

- Event-driven API for both client and server
- Automatic reconnect with backoff
- Acknowledged emits (emit + response)
- One-time listeners (`once`)
- Server-initiated ping/pong heartbeat
- Debug logging and connection status

---

## Tutorial

### Prerequisites

- Node.js (v14 or newer)
- A web browser
- A code editor (e.g., VS Code)

---

### 1. 📦 Install the Package

Initialize a new Node.js project:

```sh
npm init -y
npm install socked
```

Or clone this repo and use the files in `src/`.

---

### 1.1. 📥 Importing in Your Project

**If installed from npm:**

For **Node.js** (server):
```js
import { createServer } from 'socked';
```

For **Browser (with a bundler):**
```js
import { createClient } from 'socked';
```

**If using in the browser without a bundler (via CDN):**
```html
<script type="module">
  import { createClient } from 'https://cdn.jsdelivr.net/npm/socked/+esm';
  // ...your code...
</script>
```

---

### 2. 🛠️ Setup Server

Create the file: `examples/server.js`

```js
import { createServer } from '../src/server.js';

const wss = createServer({ port: 3000 });

wss.onClient((client) => {
  console.log('Client connected');

  client.onEvent('join', (data) => {
    console.log('Join:', data);
    client.emit('welcome', { message: `Welcome to ${data.room}` });
  });
});
```

Run the server:

```sh
node examples/server.js
```

---

### 3. 🌐 Setup Client (Browser)

Create the file: `examples/client.html`

```html
<!DOCTYPE html>
<html>
<head>
  <title>socked Client</title>
</head>
<body>
  <h1>socked Client</h1>
  <script type="module">
    import { createClient } from '../src/client.js';

    const socket = createClient('ws://localhost:3000', {
      reconnect: true
    });

    socket.on('connect', () => {
      console.log('Connected to server');
      socket.emit('join', { room: 'main' });
    });

    socket.on('welcome', (data) => {
      console.log('Server says:', data.message);
      document.body.innerHTML += `<p>${data.message}</p>`;
    });

    socket.on('disconnect', () => {
      console.log('Disconnected. Will retry...');
    });
  </script>
</body>
</html>
```

Open the file in your browser (e.g., with Live Server in VS Code).

---

### 4. 🧪 Advanced Features

#### 🔁 Emit with Acknowledgment

Client:

```js
socket.emitWithAck('saveData', { name: 'Test' })
  .then(response => console.log('✅ Ack:', response))
  .catch(err => console.error('❌ Timeout or Error:', err));
```

Server:

```js
client.onEvent('saveData', (data) => {
  console.log('Saving data:', data);
  client.emit(`saveData_ack_${data._ackId}`, { success: true });
});
```

#### 🧠 One-time Listeners

```js
socket.once('config', (cfg) => {
  console.log('Loaded config:', cfg);
});
```

#### 💓 Ping/Pong (Auto)

Handled internally: the server sends pings and expects pong responses to keep the connection alive.

#### 🛠️ Get Connection Status

```js
console.log('Connection Status:', socket.getStatus()); // "connected" or "disconnected"
```

#### 🧼 Clean Up Listeners

```js
socket.off('eventName'); // remove all listeners for that event
```

---

## API Reference

See [src/client.js](src/client.js) and [src/server.js](src/server.js) for full API details.

---

## License

MIT

---

**Contributions welcome!**  
Create an issue or open a PR on GitHub.
