export function encodeMessage(event, data) {
  return JSON.stringify({ event, data });
}

export function decodeMessage(msg) {
  try {
    return JSON.parse(msg);
  } catch (e) {
    return null;
  }
}
