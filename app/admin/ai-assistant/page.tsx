import { requireAdmin } from "@/lib/authorization";
import { isGeminiConfigured } from "@/lib/gemini";
import AdminAIChat from "@/components/AdminAIChat";

export const metadata = {
  title: "AI assistant — SkillSpark admin",
};

export default async function AdminAIAssistantPage() {
  await requireAdmin();
  const configured = isGeminiConfigured();

  if (!configured) {
    return (
      <div className="wide-canvas">
        <div
          style={{
            border: "1px solid #f1c40f",
            background: "#fffbe6",
            padding: "16px 20px",
            borderRadius: 8,
            maxWidth: 720,
          }}
        >
          <strong>Gemini is not configured.</strong>
          <p style={{ marginTop: 6 }}>
            Add <code>GOOGLE_GEMINI_API_KEY</code> to your <code>.env</code> file. Get a key from{" "}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google AI Studio
            </a>
            . Then restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-assistant-canvas">
      <AdminAIChat />
    </div>
  );
}
