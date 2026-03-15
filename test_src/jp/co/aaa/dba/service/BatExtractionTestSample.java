import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

public class BatExtractionTestSample {

    public void case01_basicSelect(Connection con) throws SQLException {
        StringBuilder sb = new StringBuilder();
        sb.append(" SELECT ");
        sb.append("   EMP_ID, ");
        sb.append("   EMP_NAME ");
        sb.append(" FROM ");
        sb.append("   EMPLOYEE ");
        sb.append(" WHERE ");
        sb.append("   EMP_ID = ? ");

        PreparedStatement prepareStatement = con.prepareStatement(sb.toString());
        prepareStatement.setString(1, "E001");
    }

    public void case02_multipleBlocks(Connection con) throws SQLException {
        StringBuilder sb1 = new StringBuilder();
        sb1.append(" INSERT INTO ");
        sb1.append("   EMPLOYEE ^(EMP_ID, EMP_NAME^) ");
        sb1.append(" VALUES ");
        sb1.append("   ^(?, ?^) ");

        PreparedStatement prepareStatement = con.prepareStatement(sb1.toString());
        prepareStatement.setString(1, "E002");
        prepareStatement.setString(2, "TARO");

        StringBuilder sb2 = new StringBuilder();
        sb2.append(" UPDATE ");
        sb2.append("   EMPLOYEE ");
        sb2.append(" SET ");
        sb2.append("   EMP_NAME = ? ");
        sb2.append(" WHERE ");
        sb2.append("   EMP_ID = ? ");

        prepareStatement = con.prepareStatement(sb2.toString());
        prepareStatement.setString(1, "JIRO");
        prepareStatement.setString(2, "E002");
    }

    public void case03_noAppendBeforePrepare(Connection con) throws SQLException {
        String sql = "DELETE FROM EMPLOYEE WHERE EMP_ID = ?";
        PreparedStatement prepareStatement = con.prepareStatement(sql);
        prepareStatement.setString(1, "E003");
    }

    public void case04_appendAfterPrepareOnly(Connection con) throws SQLException {
        StringBuilder sb = new StringBuilder();

        PreparedStatement prepareStatement = con.prepareStatement("SELECT 1 FROM DUAL");

        sb.append(" THIS_APPEND_IS_AFTER_PREPARE ");
        sb.append(" SO_PREVIOUS_BLOCK_SHOULD_NOT_MATCH ");
    }

    public void case05_withComments(Connection con) throws SQLException {
        StringBuilder sb = new StringBuilder();
        sb.append(" SELECT "); // select start
        sb.append("   DEPT_ID, "); // department id
        sb.append("   DEPT_NAME "); // department name
        sb.append(" FROM ");
        sb.append("   DEPARTMENT ");
        sb.append(" WHERE ");
        sb.append("   DELETE_FLG = '0' ");

        PreparedStatement prepareStatement = con.prepareStatement(sb.toString()); // build prepared statement
        prepareStatement.setString(1, "dummy");
    }
}
