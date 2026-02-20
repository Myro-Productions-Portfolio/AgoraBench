import morgan from 'morgan';

export const requestLogger = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  {
    stream: {
      write: (message: string) => {
        /* Strip trailing newline */
        const trimmed = message.trim();
        if (trimmed) {
          console.warn(`[HTTP] ${trimmed}`);
        }
      },
    },
  },
);
