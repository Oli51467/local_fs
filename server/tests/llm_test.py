from transformers import AutoModelForCausalLM, AutoTokenizer
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent
model_name = "Qwen/Qwen3-0.6B"

QWEN3_0_6B_MODEL_DIR = PROJECT_ROOT / "meta" / "llm" / "qwen3-0.6b"
# load the tokenizer and the model
tokenizer = AutoTokenizer.from_pretrained(str(QWEN3_0_6B_MODEL_DIR))
model = AutoModelForCausalLM.from_pretrained(
    str(QWEN3_0_6B_MODEL_DIR),
    dtype="auto",
    device_map="auto"
)

# prepare the model input
prompt = "你是谁"
messages = [
    {"role": "user", "content": prompt}
]
text = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True,
    enable_thinking=False # Switches between thinking and non-thinking modes. Default is True.
)
model_inputs = tokenizer([text], return_tensors="pt").to(model.device)

# conduct text completion
generated_ids = model.generate(
    **model_inputs,
    max_new_tokens=32768
)
output_ids = generated_ids[0][len(model_inputs.input_ids[0]):].tolist() 

# parsing thinking content
try:
    # rindex finding 151668 (</think>)
    index = len(output_ids) - output_ids[::-1].index(151668)
except ValueError:
    index = 0

thinking_content = tokenizer.decode(output_ids[:index], skip_special_tokens=True).strip("\n")
content = tokenizer.decode(output_ids[index:], skip_special_tokens=True).strip("\n")

print("thinking content:", thinking_content)
print("content:", content)
