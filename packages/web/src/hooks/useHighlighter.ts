import { useEffect, useState } from 'react';
import { getHighlighter } from '../lib/shiki';

export function useHighlighter() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getHighlighter().then(() => setReady(true));
  }, []);

  return ready;
}
