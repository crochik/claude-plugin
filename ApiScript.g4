grammar ApiScript;

program
    : importStatement* (functionDeclaration | statement)* EOF
    ;

statement
    : importStatement
    | variableDeclaration
    | expressionStatement
    | ifStatement
    | forStatement
    | whileStatement
    | returnStatement
    ;

importStatement
    : IMPORT STRING ('as' IDENTIFIER)? ';'
    ;

variableDeclaration
    : (CONST | LET) IDENTIFIER '=' expression ';'
    ;

expressionStatement
    : expression ';'
    ;

ifStatement
    : IF '(' expression ')' block (ELSE block)?
    ;

forStatement
    : FOR '(' (variableDeclaration | expressionStatement | ';')
            expression? ';'
            expression? ')' block
    ;

whileStatement
    : WHILE '(' expression ')' block
    ;

returnStatement
    : RETURN expression? ';'
    ;

functionDeclaration
    : FUNCTION IDENTIFIER '(' parameterList? ')' block
    ;

parameterList
    : parameter (',' parameter)*
    ;

parameter
    : IDENTIFIER (':' typeAnnotation)?
    ;

typeAnnotation
    : 'number'
    | 'string'
    | 'boolean'
    | 'any'
    | typeAnnotation '[' ']'     // Array type: number[], string[]
    | IDENTIFIER                 // Custom/object type
    ;

block
    : '{' statement* '}'
    | statement
    ;

assignmentTarget
    : IDENTIFIER                               # SimpleTarget
    | assignmentTarget '.' IDENTIFIER          # MemberTarget
    | assignmentTarget '[' expression ']'      # IndexTarget
    ;

expression
    : primary                                           # PrimaryExpr
    | expression '.' IDENTIFIER                         # MemberAccess
    | expression '[' expression ']'                     # ArrayAccess
    | expression '(' argumentList? ')'                  # FunctionCall
    | op=('!'|'+'|'-') expression                       # UnaryExpr
    | expression op=('*'|'/'|'%') expression            # Multiplicative
    | expression op=('+'|'-') expression                # Additive
    | expression op=('<'|'>'|'<='|'>=') expression      # Comparison
    | expression op=('=='|'!=') expression              # Equality
    | expression op=('&&'|'||') expression              # LogicalExpr
    | expression op='??' expression                     # NullCoalescing
    | <assoc=right> expression '?' expression ':' expression  # TernaryExpr
    | <assoc=right> assignmentTarget '=' expression      # AssignmentExpr
    ;

primary
    : IDENTIFIER
    | NUMBER
    | STRING
    | TRUE
    | FALSE
    | NULL
    | arrayLiteral
    | objectLiteral
    | '(' expression ')'
    ;

arrayLiteral
    : '[' (arrayElement (',' arrayElement)* ','?)? ']'
    ;

arrayElement
    : '...' expression      # ArraySpread
    | expression            # ArrayItem
    ;

objectLiteral
    : '{' (objectProperty (',' objectProperty)* ','?)? '}'
    ;

objectProperty
    : '...' expression                          # SpreadProperty
    | (IDENTIFIER | STRING) ':' expression      # PropertyPair
    ;

argumentList
    : expression (',' expression)* ','?
    ;

// Keywords
IMPORT   : 'import';
CONST    : 'const';
LET      : 'let';
FUNCTION : 'function';
IF       : 'if';
ELSE     : 'else';
FOR      : 'for';
WHILE    : 'while';
RETURN   : 'return';
TRUE     : 'true';
FALSE    : 'false';
NULL     : 'null';

// Literals
IDENTIFIER  : [a-zA-Z_][a-zA-Z0-9_]*;
NUMBER      : [0-9]+ ('.' [0-9]+)?;
STRING      : '"' (~["\r\n\\] | '\\' .)* '"'
            | '\'' (~['\r\n\\] | '\\' .)* '\'';

// Whitespace and comments
WS      : [ \t\r\n]+ -> skip;
COMMENT : '//' ~[\r\n]* -> skip;
BLOCK_COMMENT : '/*' .*? '*/' -> skip;