import WebSocket from "ws";

const WS_URL = "ws://localhost:3000/api/ws";
const HOST_ACCESS_CODE = "admin";

function connect(label) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const received = [];
    ws.on("open", () => {
      console.log(`[${label}] connected`);
      resolve({ ws, received });
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      received.push(msg);
      console.log(`[${label}] <<< ${msg.type}`, JSON.stringify(msg.payload).slice(0, 200));
    });
    ws.on("error", (e) => console.error(`[${label}] error`, e.message));
  });
}

function send(ws, label, type, payload) {
  const msg = JSON.stringify({ type, payload });
  console.log(`[${label}] >>> ${type}`, JSON.stringify(payload).slice(0, 200));
  ws.send(msg);
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  // 1. Connect user
  const { ws: userWs, received: userMsgs } = await connect("USER");
  const clientId = `anon-test-${Date.now()}`;
  send(userWs, "USER", "qa_client_join", { clientId });
  await wait(300);

  // 2. Connect host
  const { ws: hostWs, received: hostMsgs } = await connect("HOST");
  send(hostWs, "HOST", "qa_host_join", { accessKey: HOST_ACCESS_CODE });
  await wait(300);

  // 3. User asks a question
  send(userWs, "USER", "ask_global_question", { text: "What is the roadmap for Q3?" });
  await wait(500);

  // 4. Check host received the question
  const hostGotQuestion = hostMsgs.find(m => m.type === "global_new_question");
  console.log("\n--- CHECK 1: Host received new question ---");
  if (hostGotQuestion) {
    console.log("✅ PASS — host received:", hostGotQuestion.payload.text);
    console.log("   isPublic on host side:", hostGotQuestion.payload.isPublic); // should be false
  } else {
    console.log("❌ FAIL — host did NOT receive the question");
    process.exit(1);
  }

  const questionId = hostGotQuestion.payload.id;

  // 5. Check that user received their own question (mine: true)
  const userGotOwn = userMsgs.find(m => m.type === "global_new_question" && m.payload.mine === true);
  console.log("\n--- CHECK 2: User sees their own question ---");
  if (userGotOwn) {
    console.log("✅ PASS — user sees own question (mine: true)");
  } else {
    console.log("❌ FAIL — user did NOT see their own question");
  }

  // 6. Host answers privately
  send(hostWs, "HOST", "answer_global_question", { questionId, answer: "We are planning feature X and Y.", hostName: "TestHost" });
  await wait(500);

  // 7. Check host received qa_answered (private)
  const hostGotAnswer = hostMsgs.find(m => m.type === "global_qa_answered");
  console.log("\n--- CHECK 3: Host sees their private answer ---");
  if (hostGotAnswer) {
    console.log("✅ PASS — host sees answer:", hostGotAnswer.payload.answer);
    console.log("   isPublic:", hostGotAnswer.payload.isPublic); // should be false
  } else {
    console.log("❌ FAIL — host did NOT receive qa_answered");
  }

  // 8. Check user received private reply
  const userGotPrivate = userMsgs.find(m => m.type === "global_qa_answered_private");
  console.log("\n--- CHECK 4: User receives private reply ---");
  if (userGotPrivate) {
    console.log("✅ PASS — user got private reply:", userGotPrivate.payload.answer);
    console.log("   isPublic:", userGotPrivate.payload.isPublic); // should be false
    console.log("   mine:", userGotPrivate.payload.mine); // should be true
  } else {
    console.log("❌ FAIL — user did NOT receive private reply");
  }

  // 9. Connect a third "observer" user — should NOT see the private answer
  const { ws: observerWs, received: observerMsgs } = await connect("OBSERVER");
  const observerId = `anon-observer-${Date.now()}`;
  send(observerWs, "OBSERVER", "qa_client_join", { clientId: observerId });
  await wait(400);

  const observerSawPrivate = observerMsgs.find(m =>
    (m.type === "global_live_questions_list" && m.payload.questions?.some((q) => q.answer !== null))
  );
  console.log("\n--- CHECK 5: Observer cannot see private answer ---");
  if (!observerSawPrivate) {
    console.log("✅ PASS — observer sees no answered questions in the list");
  } else {
    console.log("❌ FAIL — observer CAN see private answer:", JSON.stringify(observerSawPrivate));
  }

  // 10. Host publishes the question
  send(hostWs, "HOST", "publish_global_question", { questionId });
  await wait(500);

  // 11. Observer should now receive global_qa_published
  const observerGotPublic = observerMsgs.find(m => m.type === "global_qa_published");
  console.log("\n--- CHECK 6: Observer receives public broadcast after host publishes ---");
  if (observerGotPublic) {
    console.log("✅ PASS — observer got published Q&A:", observerGotPublic.payload.answer);
    console.log("   isPublic:", observerGotPublic.payload.isPublic); // should be true
  } else {
    console.log("❌ FAIL — observer did NOT receive published Q&A");
  }

  console.log("\n=== TEST COMPLETE ===");
  userWs.close();
  hostWs.close();
  observerWs.close();
}

run().catch(console.error);
