from mem0 import MemoryClient

if __name__ == "__main__":
    m = MemoryClient(api_key="m0-EWmOfEEDu43h2PaNlXAQFRBYaE443FPgxHtm2aFY")
    # For a user
    messages = [
        {
            "role": "user",
            "content": "I like to drink coffee in the morning and go for a walk",
        }
    ]
    result = m.add(messages, user_id="alice", metadata={"category": "preferences"})

    related_memories = m.search("Should I drink coffee or tea?", user_id="alice")
    print("Related memories:", related_memories)
