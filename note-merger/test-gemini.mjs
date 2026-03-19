import { GoogleGenerativeAI } from "@google/generative-ai";
const key = "AIzaSyDQas7RfS_qn6mp9wfzzEahZqHChYYBeBo";
const genAI = new GoogleGenerativeAI(key);
const model = genAI.getGenerativeModel({ model: "gemma-3-27b-it", systemInstruction: "test" });
try {
  await model.generateContent("hello");
} catch (e) {
  console.log("MESSAGE:", e.message);
}
