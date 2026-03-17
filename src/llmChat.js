const { logger } = require('./logger');

class JapaneseLLMResponder {
  constructor(config = {}, botName = 'bot') {
    this.config = {
      enabled: false,
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:3b',
      timeoutMs: 12_000,
      fallbackRuleBased: true,
      ...config
    };
    this.botName = botName;
  }

  get isEnabled() {
    return Boolean(this.config.enabled);
  }

  async generateReply(playerName, message, contextText = '') {
    if (!this.isEnabled) {
      return null;
    }

    if (this.config.provider === 'ollama') {
      try {
        return await this.askOllama(playerName, message, contextText);
      } catch (error) {
        logger.warn('LLM 応答生成に失敗したためフォールバックします。', error);
      }
    }

    if (this.config.fallbackRuleBased) {
      return this.ruleBasedReply(playerName, message, contextText);
    }

    return null;
  }

  async askOllama(playerName, message, contextText) {
    const prompt = [
      `あなたは Minecraft Bot「${this.botName}」です。`,
      '日本語で短く自然に返答してください。',
      '危険行為や荒らし依頼は断ってください。',
      contextText ? `状況: ${contextText}` : '',
      `${playerName}: ${message}`,
      `${this.botName}:`
    ].filter(Boolean).join('\n');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(this.config.timeoutMs || 12_000));

    try {
      const response = await fetch(`${this.config.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          prompt,
          stream: false,
          options: {
            temperature: 0.4,
            num_predict: 80
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama HTTP ${response.status}`);
      }

      const json = await response.json();
      const text = String(json.response || '').trim();
      return text || null;
    } finally {
      clearTimeout(timer);
    }
  }

  ruleBasedReply(playerName, message, contextText) {
    const m = String(message || '').toLowerCase();

    if (m.includes('こんにちは') || m.includes('こん') || m.includes('hello')) {
      return `${playerName}さん、こんにちは。状況を確認しながら行動します。`;
    }

    if (m.includes('状態') || m.includes('status')) {
      return `了解です。現在の状況は「${contextText || 'データ取得中'}」です。`;
    }

    if (m.includes('掘') || m.includes('採掘') || m.includes('mine')) {
      return '採掘系の指示は「!bot mine <ブロック名> <個数>」で実行できます。';
    }

    if (m.includes('ありがと') || m.includes('助か')) {
      return 'どういたしまして。次の作業も任せてください。';
    }

    return '了解しました。必要な作業を優先して進めます。';
  }
}

module.exports = {
  JapaneseLLMResponder
};
