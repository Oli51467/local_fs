from langchain_text_splitters import RecursiveCharacterTextSplitter

if __name__ == "__main__":
    text_splitter = RecursiveCharacterTextSplitter(
        separators=["\n\n", "\n"],
        chunk_size=300,
        chunk_overlap=80,
    )
    # use text2.txt
    with open("../../data/test2.txt", "r", encoding="utf-8") as f:
        text = f.read()
    chunks = text_splitter.split_text(text)
    for chunk in chunks:
        print(chunk)