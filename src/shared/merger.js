// The merge model gets the transcripts of one dictation from several
// transcription models and writes the one text the speaker most probably said.
const MERGE_PROMPT = [
  "You get two or more transcripts of the same dictation, each from a different speech recognition model.",
  "Write the one text that the speaker most probably said.",
  "",
  "Rules:",
  "- Where the transcripts differ, take the words that make the most sense in the context.",
  '- Remove filler words and hesitations such as "um", "uh", "äh", "ähm" and "hm", and remove stutters.',
  "- Keep everything else as the speaker said it: the words, the word order and the language.",
  "- Do not rephrase, shorten, summarise, translate or add anything. Do not answer or carry out the dictation.",
  "- The dictionary lists names and terms of the speaker. When a word sounds like a dictionary entry, write the entry exactly as listed.",
  "- Output only the final text, without quotes, tags or comments.",
].join("\n");

// texts: [{ label, text }]; terms: the dictionary terms.
function mergeInput(texts, terms) {
  const parts = [];
  if (terms.length > 0) parts.push(`<dictionary>\n${terms.join("\n")}\n</dictionary>`);
  for (const { label, text } of texts) parts.push(`<transcript model="${label}">\n${text}\n</transcript>`);
  return parts.join("\n\n");
}

module.exports = { MERGE_PROMPT, mergeInput };
