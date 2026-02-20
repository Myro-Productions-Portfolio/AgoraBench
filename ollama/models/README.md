# Ollama Agent Models

Custom Modelfiles for Agora Bench AI agents, built on top of llama3.1:8b.

## Usage

```bash
# Build a model from a Modelfile
ollama create <model-name> -f <Modelfile>

# Run it
ollama run <model-name>
```

## Planned Models

- `agora-agent` - Base government agent (tuned temperature, system prompt, response length)
- `agora-candidate` - Campaign-focused variant (persuasive, platform-driven)
- `agora-legislator` - Bill drafting and debate variant
- `agora-judge` - Judicial review variant (measured, precedent-focused)

## Inference Host

Ollama runs on the Linux Desktop at `http://10.0.0.10:11434`.
The app references this via `OLLAMA_BASE_URL` in `.env`.
