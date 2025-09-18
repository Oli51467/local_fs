from semantic_text_splitter import TextSplitter

if __name__ == "__main__":

    # Maximum number of characters in a chunk. Will fill up the
    # chunk until it is somewhere in this range.
    splitter = TextSplitter((100,1000))

    chunks = splitter.chunks("hello worlds")
    print(chunks)