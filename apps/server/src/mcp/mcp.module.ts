import { Module } from '@nestjs/common';
import { DefectsModule } from '../defects/defects.module';
import { ProjectsModule } from '../projects/projects.module';
import { TestingModule } from '../testing/testing.module';
import { DefectMaterialsService } from './defect-materials.service';
import { McpController } from './mcp.controller';
import { McpServerFactory } from './mcp-server.factory';

@Module({
  imports: [ProjectsModule, DefectsModule, TestingModule],
  controllers: [McpController],
  providers: [McpServerFactory, DefectMaterialsService],
})
export class McpModule {}
