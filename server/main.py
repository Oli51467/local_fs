# server/main.py
import os
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Hello from Python backend!"}

@app.get("/health")
async def health():
    return {"status": "ok1"}

@app.get("/hello")
async def hello():
    return {"message": "Hello World!", "status": "success"}

@app.post("/hello")
async def hello_post(data: dict = None):
    return {"message": "Hello from POST!", "received_data": data, "status": "success"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="127.0.0.1", port=port, log_level="info")
