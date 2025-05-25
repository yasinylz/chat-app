const socket = new WebSocket(`ws://localhost:3000/ws?token=${getCookie('auth')}`)
const messages = document.getElementById("messages")
const input = document.getElementById("messageInput")

socket.onmessage = (event) => {
  const { from, text } = JSON.parse(event.data)
  const div = document.createElement("div")
  div.className = "message received"
  div.textContent = text
  messages.appendChild(div)
}

function sendMessage() {
  const text = input.value.trim()
  if (!text) return
  socket.send(JSON.stringify({ from: CURRENT_USER_ID, to: TARGET_USER_ID, text }))
  const div = document.createElement("div")
  div.className = "message sent"
  div.textContent = text
  messages.appendChild(div)
  input.value = ""
}

function getCookie(name) {
  return document.cookie.split('; ').find(row => row.startsWith(name + '='))?.split('=')[1]
}
