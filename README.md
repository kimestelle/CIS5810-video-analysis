# CIS5810-video-analysis
## Running Instructions (Terminal Commands)
Frontend:
```cd video-analysis-frontend```

```npm i```

```npm run dev```

Backend FastAPI:
```cd video-analysis-backend```
(start venv if on Mac)
```pip install -r requirements.txt```

```uvicorn main:app```

```celery -A tasks.celery_app worker```