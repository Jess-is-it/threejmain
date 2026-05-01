import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CustomerType } from '@prisma/client';

class SecondaryContactDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  contactNumber?: string;

  @IsOptional()
  @IsString()
  facebookAccount?: string;

  @IsOptional()
  @IsString()
  facebookProfileLink?: string;

  @IsOptional()
  @IsString()
  relationship?: string;
}

export class CreateCustomerDto {
  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsString()
  contactNumber!: string;

  @IsOptional()
  @IsString()
  alternateMobileNumber?: string;

  @IsString()
  facebookAccountName!: string;

  @IsOptional()
  @IsString()
  facebookProfileLink?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SecondaryContactDto)
  secondaryContacts?: SecondaryContactDto[];

  @IsOptional()
  @IsString()
  secondaryContactName?: string;

  @IsOptional()
  @IsString()
  secondaryContactNumber?: string;

  @IsOptional()
  @IsString()
  secondaryContactFacebookAccount?: string;

  @IsOptional()
  @IsString()
  secondaryContactRelationship?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  addressLine1!: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsString()
  barangay!: string;

  @IsString()
  city!: string;

  @IsString()
  province!: string;

  @IsOptional()
  @IsString()
  latitude?: string;

  @IsOptional()
  @IsString()
  longitude?: string;

  @IsEnum(CustomerType)
  customerType!: CustomerType;
}
