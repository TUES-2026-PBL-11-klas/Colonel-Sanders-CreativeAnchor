from google import genai
from google.genai import types
import io
import uuid
from src.services.supabase import _Client

_AIModel = "gemini-3.5-flash"

_AIClient = genai.Client()

_AIPrompt = """
Act as an Expert Art Critic and Psychological Mentor specializing in creative burnout.

Your goal is to analyze the attached artwork [FILE] to identify technical friction points that contribute to "Artistic Burnout." Creative burnout often occurs when a creator spends excessive time fighting fundamental errors that make the piece feel "off" without knowing why, leading to cognitive fatigue and a desire to abandon the project.

Analyze the artwork through these specific lenses:
1. Technical Foundations: Proportions, perspective, and anatomy.
2. Lighting & Values: Inconsistent light sources, muddy shading, or value compression.
3. Color Theory: Clashing palettes, oversaturation, or lack of a clear focal point.
4. Composition: Crowded spaces, poor tangency, or weak visual "flow."

CRITICAL CONSTRAINTS:
- Limit the 'technical_audit' to a maximum of 2 or 3 core issues. Do not overwhelm the creator.
- Focus on the "Burnout Trigger": Identify the single technical flaw most likely causing the user's current frustration.
- Action plan steps must be low-friction "quick wins"—actionable technical fixes that require low energy but yield high visual clarity to restore the artist's confidence.

OUTPUT INSTRUCTIONS:
- You must return ONLY a valid JSON object. Do not include any conversational text, introduction, or markdown wrapper outside the JSON.
- For all descriptive text fields, ensure the language explicitly implies the severity, burnout risk, and necessary effort level, balancing absolute technical precision with deep empathy.

JSON SCHEMA:
{
  "analysis_metadata": {
    "detected_medium": "string",
    "primary_mood": "string",
    "burnout_trigger_summary": "string"
  },
  "technical_audit": [
    {
      "category": "string",
      "issue": "string",
      "location_context": "Specific description of where this issue occurs on the canvas",
      "description": "Technical breakdown of what is wrong.",
      "burnout_connection": "Why this specific issue leads to creative fatigue or subconscious frustration."
    }
  ],
  "psychological_insight": "A brief, deeply encouraging message addressing the creator's mental state, validating their effort, and contextualizing mistakes as a natural part of growth.",
  "action_plan": [
    {
      "step_number": 1,
      "step": "Low-energy, specific actionable instruction.",
      "benefit": "How this specific change will instantly relieve visual friction and mental stress."
    }
  ]
}
"""


def _map_role(role: str) -> str:
    if role == "human":
        return "user"
    if role == "ai":
        return "model"
    return role


def _get_history(chat_uuid: uuid):
    res = (
       _Client.table("messages")
       .select("*")
       .eq("chat_id", chat_uuid)
       .order("created_at", desc=False)
       .execute()
     )
    return res.data


def _chat(image_data, custom_prompt=None, history=None):
    buffer = io.BytesIO(image_data)
    buffer.name = "image.png"
    uploaded_file = _AIClient.files.upload(
        file=buffer,
        config={"mime_type": "image/png"},
    )
    contents = [uploaded_file]

    # supabase returns a list <- res.data
    history = history or []

    for msg in history:
        role = _map_role(msg.get("role"))
        content = msg.get("content")

        if not content:
            continue

        contents.append(
            types.Content(
                role=role,
                parts=[types.Part.from_text(text=content)]
            )
        )

    if custom_prompt:
        contents.append(types.Part.from_text(text=custom_prompt))
    res = _AIClient.models.generate_content(
        model=_AIModel,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=_AIPrompt
        )
    )
    return res
