import { Global, Module } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env';
import { CosStorage } from './cos.storage';
import { LocalStorage } from './local.storage';
import { LocalStorageController } from './local-storage.controller';
import { OBJECT_STORAGE, type ObjectStorage } from './storage.types';

@Global()
@Module({
  controllers: [LocalStorageController],
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [APP_ENV],
      useFactory: (env: AppEnv): ObjectStorage =>
        env.STORAGE_DRIVER === 'cos'
          ? new CosStorage({
              secretId: env.COS_SECRET_ID!,
              secretKey: env.COS_SECRET_KEY!,
              bucket: env.COS_BUCKET!,
              region: env.COS_REGION,
              appId: env.COS_APPID!,
            })
          : new LocalStorage(env.LOCAL_STORAGE_DIR, env.LOCAL_STORAGE_SECRET, env.PUBLIC_BASE_URL),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
