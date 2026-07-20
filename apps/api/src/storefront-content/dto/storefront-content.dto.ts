import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class StorefrontContentSlugParamDto {
  @ApiProperty({ maxLength: 180, pattern: SLUG_PATTERN.source })
  @IsString()
  @Length(1, 180)
  @Matches(SLUG_PATTERN)
  slug!: string;
}

export class PublishedLegalDocumentDto {
  @ApiProperty()
  slug!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ description: 'Immutable operator-defined version number.' })
  version!: string;

  @ApiProperty({ format: 'date-time' })
  publishedAt!: string;

  @ApiProperty()
  content!: string;
}

export class PublishedLegalDocumentResponseDto {
  @ApiProperty({ type: PublishedLegalDocumentDto })
  data!: PublishedLegalDocumentDto;
}

export class StorefrontContentDto {
  @ApiProperty()
  title!: string;

  @ApiProperty()
  content!: string;
}

export class StorefrontContentResponseDto {
  @ApiProperty({ type: StorefrontContentDto })
  data!: StorefrontContentDto;
}
