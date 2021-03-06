import { resolveExternalModuleAndFn } from 'graphql-codegen-plugin-helpers';
import {
  EnumTypeDefinitionNode,
  ScalarTypeDefinitionNode,
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
  NamedTypeNode,
  NameNode
} from 'graphql';
import { DeclarationBlock, wrapWithSingleQuotes, indent, toPascalCase } from './utils';
import { ScalarsMap, EnumValuesMap, FlowPluginConfig } from './index';
import { OperationVariablesToObject } from './variables-to-object';
import {
  NonNullTypeNode,
  ListTypeNode,
  ObjectTypeDefinitionNode,
  FieldDefinitionNode,
  InterfaceTypeDefinitionNode,
  UnionTypeDefinitionNode,
  DirectiveDefinitionNode
} from 'graphql/language/ast';

export const DEFAULT_SCALARS = {
  ID: 'string',
  String: 'string',
  Boolean: 'boolean',
  Int: 'number',
  Float: 'number',
  string: 'string',
  number: 'number',
  boolean: 'boolean'
};
export interface ParsedConfig {
  scalars: ScalarsMap;
  enumValues: EnumValuesMap;
  convert: (str: string) => string;
  typesPrefix: string;
  useFlowExactObjects: boolean;
  useFlowReadOnlyTypes: boolean;
}

export interface BasicFlowVisitor {
  scalars: ScalarsMap;
  convertName: (name: any, addPrefix: boolean) => string;
}

export class FlowVisitor implements BasicFlowVisitor {
  private _parsedConfig: ParsedConfig;

  constructor(pluginConfig: FlowPluginConfig) {
    this._parsedConfig = {
      scalars: { ...DEFAULT_SCALARS, ...(pluginConfig.scalars || {}) },
      enumValues: pluginConfig.enumValues || {},
      convert: pluginConfig.namingConvention ? resolveExternalModuleAndFn(pluginConfig.namingConvention) : toPascalCase,
      typesPrefix: pluginConfig.typesPrefix || '',
      useFlowExactObjects: pluginConfig.useFlowExactObjects || false,
      useFlowReadOnlyTypes: pluginConfig.useFlowReadOnlyTypes || false
    };
  }

  convertName(name: any, addPrefix = true): string {
    return (addPrefix ? this._parsedConfig.typesPrefix : '') + this._parsedConfig.convert(name);
  }

  get scalars(): ScalarsMap {
    return this._parsedConfig.scalars;
  }

  ScalarTypeDefinition = (node: ScalarTypeDefinitionNode): string => {
    return new DeclarationBlock(this._parsedConfig)
      .export()
      .asKind('type')
      .withName(this.convertName(node.name))
      .withContent(this._parsedConfig.scalars[(node.name as any) as string] || 'any').string;
  };

  DirectiveDefinition = (node: DirectiveDefinitionNode): string => {
    return '';
  };

  NamedType = (node: NamedTypeNode): string => {
    const asString = (node.name as any) as string;
    const type = this._parsedConfig.scalars[asString] || this.convertName(asString);

    return `?${type}`;
  };

  ListType = (node: ListTypeNode): string => {
    const asString = (node.type as any) as string;

    return `?Array<${asString}>`;
  };

  NonNullType = (node: NonNullTypeNode): string => {
    const asString = (node.type as any) as string;

    if (asString.charAt(0) === '?') {
      return asString.substr(1);
    }

    return asString;
  };

  Name = (node: NameNode): string => {
    return node.value;
  };

  InputObjectTypeDefinition = (node: InputObjectTypeDefinitionNode): string => {
    return new DeclarationBlock(this._parsedConfig)
      .export()
      .asKind('type')
      .withName(this.convertName(node.name))
      .withBlock(node.fields.join('\n')).string;
  };

  InputValueDefinition = (node: InputValueDefinitionNode): string => {
    return indent(`${node.name}: ${node.type},`);
  };

  FieldDefinition = (node: FieldDefinitionNode): string => {
    const typeString = (node.type as any) as string;
    const namePostfix = typeString.charAt(0) === '?' ? '?' : '';
    return indent(`${node.name}${namePostfix}: ${typeString},`);
  };

  UnionTypeDefinition = (node: UnionTypeDefinitionNode): string => {
    const possibleTypes = node.types.map(name => ((name as any) as string).replace('?', '')).join(' | ');

    return new DeclarationBlock(this._parsedConfig)
      .export()
      .asKind('type')
      .withName(this.convertName(node.name))
      .withContent(possibleTypes).string;
  };

  ObjectTypeDefinition = (node: ObjectTypeDefinitionNode, key, parent): string => {
    const interfaces =
      node.interfaces && node.interfaces.length > 0
        ? node.interfaces.map(name => ((name as any) as string).replace('?', '')).join(' & ') + ' & '
        : '';

    const typeDefinition = new DeclarationBlock(this._parsedConfig)
      .export()
      .asKind('type')
      .withName(this.convertName(node.name))
      .withContent(interfaces)
      .withBlock(node.fields.join('\n')).string;

    const original = parent[key];
    const fieldsWithArguments = original.fields.filter(field => field.arguments && field.arguments.length > 0);
    const fieldsArguments = fieldsWithArguments.map(field => {
      const name = original.name.value + this.convertName(field.name.value, false) + 'Args';
      const transformedArguments = new OperationVariablesToObject<FlowVisitor, InputValueDefinitionNode>(
        this,
        field.arguments
      );

      return new DeclarationBlock(this._parsedConfig)
        .export()
        .asKind('type')
        .withName(this.convertName(name))
        .withBlock(transformedArguments.string).string;
    });

    return [typeDefinition, ...fieldsArguments].filter(f => f).join('\n\n');
  };

  InterfaceTypeDefinition = (node: InterfaceTypeDefinitionNode): string => {
    return new DeclarationBlock(this._parsedConfig)
      .export()
      .asKind('type')
      .withName(this.convertName(node.name))
      .withBlock(node.fields.join('\n')).string;
  };

  EnumTypeDefinition = (node: EnumTypeDefinitionNode): string => {
    const enumValuesName = `${node.name}Values`;

    const enumValues = new DeclarationBlock(this._parsedConfig)
      .export()
      .asKind('const')
      .withName(this.convertName(enumValuesName))
      .withMethodCall('Object.freeze')
      .withBlock(
        node.values
          .map(enumOption =>
            indent(
              `${this.convertName(enumOption.name)}: ${wrapWithSingleQuotes(
                this._parsedConfig.enumValues[(enumOption.name as any) as string] || enumOption.name
              )}`
            )
          )
          .join(', \n')
      ).string;

    const enumType = new DeclarationBlock(this._parsedConfig)
      .export()
      .asKind('type')
      .withName(this.convertName(node.name))
      .withContent(`$Values<typeof ${this.convertName(enumValuesName)}>`).string;

    return [enumValues, enumType].join('\n\n');
  };
}
