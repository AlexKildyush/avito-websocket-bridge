import * as Joi from 'joi';

interface AppEnv {
  PORT: number;
  TARGET_CONTACTS: string;
  AVITO_BASE_URL: string;
  AVITO_MESSAGES_URL: string;
  AVITO_LOGIN?: string;
  AVITO_PASSWORD?: string;
  AVITO_USER_DATA_DIR: string;
  PUPPETEER_HEADLESS: boolean;
  PUPPETEER_SLOW_MO: number;
  PUPPETEER_TIMEOUT_MS: number;
  CLOUDFLARED_PUBLIC_URL?: string;
}

const schema = Joi.object<AppEnv>({
  PORT: Joi.number().default(3000),
  TARGET_CONTACTS: Joi.string().required(),
  AVITO_BASE_URL: Joi.string().uri().required(),
  AVITO_MESSAGES_URL: Joi.string().uri().required(),
  AVITO_LOGIN: Joi.string().allow('').optional(),
  AVITO_PASSWORD: Joi.string().allow('').optional(),
  AVITO_USER_DATA_DIR: Joi.string().default('.avito-session'),
  PUPPETEER_HEADLESS: Joi.boolean().truthy('true').falsy('false').default(false),
  PUPPETEER_SLOW_MO: Joi.number().integer().min(0).default(0),
  PUPPETEER_TIMEOUT_MS: Joi.number().integer().min(1000).default(30000),
  CLOUDFLARED_PUBLIC_URL: Joi.string().uri().allow('').optional(),
}).unknown(true);

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const { error, value } = schema.validate(config, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    throw new Error(`Environment validation failed: ${error.message}`);
  }

  return value;
}
