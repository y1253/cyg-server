import * as runtime from "@prisma/client/runtime/index-browser";
export type * from '../models.js';
export type * from './prismaNamespace.js';
export declare const Decimal: typeof runtime.Decimal;
export declare const NullTypes: {
    DbNull: (new (secret: never) => typeof runtime.DbNull);
    JsonNull: (new (secret: never) => typeof runtime.JsonNull);
    AnyNull: (new (secret: never) => typeof runtime.AnyNull);
};
export declare const DbNull: any;
export declare const JsonNull: any;
export declare const AnyNull: any;
export declare const ModelName: {
    readonly User: "User";
    readonly Client: "Client";
    readonly Assignment: "Assignment";
    readonly Task: "Task";
};
export type ModelName = (typeof ModelName)[keyof typeof ModelName];
export declare const TransactionIsolationLevel: {
    readonly ReadUncommitted: "ReadUncommitted";
    readonly ReadCommitted: "ReadCommitted";
    readonly RepeatableRead: "RepeatableRead";
    readonly Serializable: "Serializable";
};
export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel];
export declare const UserScalarFieldEnum: {
    readonly id: "id";
    readonly name: "name";
    readonly email: "email";
    readonly password: "password";
    readonly role: "role";
    readonly createdAt: "createdAt";
    readonly updatedAt: "updatedAt";
};
export type UserScalarFieldEnum = (typeof UserScalarFieldEnum)[keyof typeof UserScalarFieldEnum];
export declare const ClientScalarFieldEnum: {
    readonly id: "id";
    readonly businessName: "businessName";
    readonly contactName: "contactName";
    readonly email: "email";
    readonly phone: "phone";
    readonly industry: "industry";
    readonly createdAt: "createdAt";
    readonly updatedAt: "updatedAt";
};
export type ClientScalarFieldEnum = (typeof ClientScalarFieldEnum)[keyof typeof ClientScalarFieldEnum];
export declare const AssignmentScalarFieldEnum: {
    readonly id: "id";
    readonly userId: "userId";
    readonly clientId: "clientId";
    readonly assignedAt: "assignedAt";
};
export type AssignmentScalarFieldEnum = (typeof AssignmentScalarFieldEnum)[keyof typeof AssignmentScalarFieldEnum];
export declare const TaskScalarFieldEnum: {
    readonly id: "id";
    readonly title: "title";
    readonly description: "description";
    readonly status: "status";
    readonly dueDate: "dueDate";
    readonly createdAt: "createdAt";
    readonly updatedAt: "updatedAt";
    readonly clientId: "clientId";
    readonly assignedToId: "assignedToId";
};
export type TaskScalarFieldEnum = (typeof TaskScalarFieldEnum)[keyof typeof TaskScalarFieldEnum];
export declare const SortOrder: {
    readonly asc: "asc";
    readonly desc: "desc";
};
export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder];
export declare const UserOrderByRelevanceFieldEnum: {
    readonly name: "name";
    readonly email: "email";
    readonly password: "password";
};
export type UserOrderByRelevanceFieldEnum = (typeof UserOrderByRelevanceFieldEnum)[keyof typeof UserOrderByRelevanceFieldEnum];
export declare const NullsOrder: {
    readonly first: "first";
    readonly last: "last";
};
export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder];
export declare const ClientOrderByRelevanceFieldEnum: {
    readonly businessName: "businessName";
    readonly contactName: "contactName";
    readonly email: "email";
    readonly phone: "phone";
    readonly industry: "industry";
};
export type ClientOrderByRelevanceFieldEnum = (typeof ClientOrderByRelevanceFieldEnum)[keyof typeof ClientOrderByRelevanceFieldEnum];
export declare const TaskOrderByRelevanceFieldEnum: {
    readonly title: "title";
    readonly description: "description";
};
export type TaskOrderByRelevanceFieldEnum = (typeof TaskOrderByRelevanceFieldEnum)[keyof typeof TaskOrderByRelevanceFieldEnum];
